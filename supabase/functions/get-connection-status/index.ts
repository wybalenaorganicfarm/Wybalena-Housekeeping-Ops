// get-connection-status — app-facing (admin only). Runs the SAME read-only probes
// as health-check but WITHOUT sending emails, so the portal can show live
// connection status on demand. Also returns which Google account is linked
// (never the token). verify_jwt = true.
//
// It also RECONCILES the in-app connection_down alert against what it just
// measured (see reconcileAlert). health-check only runs once a day, so without
// this the "connections need attention" alert sat on the Dashboard and Alerts
// page until the next nightly run — long after the admin had reconnected and
// this very page was showing everything green. Every reconnect path ends in a
// call here (Google OAuth, the WhatsApp QR modal, "Run Connection Check", and
// simply opening the page), so this is the one place that catches them all.
import { serviceClient } from "../_shared/client.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { checkHealth as checkWhapi } from "../_shared/adapters/whatsapp.ts";
import { checkHealth as checkGmail } from "../_shared/adapters/email.ts";
import { checkHealth as checkCalendar } from "../_shared/adapters/calendar.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

// Friendly labels mirror health-check so the UI and emails read the same.
const LABEL: Record<string, string> = {
  supabase: "App Database",
  whapi: "WhatsApp Messaging",
  gmail: "Email Sending (Gmail)",
  google_calendar: "Booking Calendar (Google Calendar)",
};

// Which connections are re-authorisable via the one-click Google flow.
const GOOGLE_SERVICES = new Set(["gmail", "google_calendar"]);

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  async function checkSupabase() {
    try {
      const { error } = await sb.from("cleaners").select("id", { count: "exact", head: true });
      return { name: "supabase", configured: true, ok: !error, detail: error ? error.message : "reachable" };
    } catch (e) {
      return { name: "supabase", configured: true, ok: false, detail: String(e) };
    }
  }

  const [supabaseR, whapi, gmail, calendar] = await Promise.all([
    checkSupabase(), checkWhapi(), checkGmail(), checkCalendar(),
  ]);

  const results = [supabaseR, whapi, gmail, calendar].map((r) => ({
    ...r,
    label: LABEL[r.name] ?? r.name,
    provider: GOOGLE_SERVICES.has(r.name) ? "google" : r.name,
  }));

  const alertResolved = await reconcileAlert(sb, results, caller.userId);

  const { data: g } = await sb
    .from("integration_tokens")
    .select("connected_email, connected_at")
    .eq("provider", "google")
    .maybeSingle();

  return json({
    results,
    google: g ? { email: g.connected_email, connectedAt: g.connected_at } : null,
    // True only on the run that actually cleared the alert, so the portal can
    // refresh its alert list / badge and say so once, rather than every poll.
    alertResolved,
  });
});

// Bring the open connection_down alert in line with the probes we just ran.
//
// This only ever RESOLVES or RETITLES an existing open alert — it never RAISES
// one. Raising stays with health-check, which also emails/WhatsApps the
// diagnosis and next steps; a transient probe blip while an admin happens to
// have this page open must not create an in-app alert nobody was told about.
//
// Returns true only when it closed the alert, so the caller can report it once.
async function reconcileAlert(
  sb: ReturnType<typeof serviceClient>,
  results: { name: string; label: string; configured: boolean; ok: boolean }[],
  userId: string,
): Promise<boolean> {
  const broken = results.filter((r) => r.configured && !r.ok);

  const { data: open } = await sb
    .from("alerts")
    .select("id")
    .eq("alert_type", "connection_down")
    .eq("status", "open");
  if (!open || open.length === 0) return false;

  // Still something down — narrow the alert to what is ACTUALLY still broken,
  // so a partial recovery (say Google back, WhatsApp still out) stops naming
  // connections that are working again.
  if (broken.length > 0) {
    const labels = broken.map((b) => b.label).join(", ");
    await sb.from("alerts")
      .update({
        title: `${broken.length} connection${broken.length === 1 ? "" : "s"} need${broken.length === 1 ? "s" : ""} attention`,
        body: `Not working: ${labels}. Open Connections (Administration) to reconnect.`,
      })
      .eq("alert_type", "connection_down")
      .eq("status", "open");
    return false;
  }

  // Everything configured is working — the alert has served its purpose.
  // 'actioned' (not 'dismissed') is the same status health-check uses when it
  // finds a recovered system, so both paths read identically under Resolved.
  await sb.from("alerts")
    .update({ status: "actioned", actioned_at: new Date().toISOString(), actioned_by: userId })
    .eq("alert_type", "connection_down")
    .eq("status", "open");

  const working = results.filter((r) => r.configured && r.ok).map((r) => r.label);
  await writeAuditLog(sb, {
    event_type: "health.recovered",
    event_label: "Connection Health Check",
    status: "success",
    summary: `All connections are working again (${working.join(", ")}). The "connections need attention" alert was cleared automatically.`,
    detail: { working, cleared_alerts: open.length },
    source: "get-connection-status",
    triggered_by: "manual",
  });
  return true;
}

// get-connection-status — app-facing (admin only). Runs the SAME read-only probes
// as health-check but WITHOUT sending emails or writing logs, so the portal can
// show live connection status on demand. Also returns which Google account is
// linked (never the token). verify_jwt = true.
import { serviceClient } from "../_shared/client.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { checkHealth as checkWhapi } from "../_shared/adapters/whatsapp.ts";
import { checkHealth as checkGmail } from "../_shared/adapters/email.ts";
import { checkHealth as checkCalendar } from "../_shared/adapters/calendar.ts";

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

  const { data: g } = await sb
    .from("integration_tokens")
    .select("connected_email, connected_at")
    .eq("provider", "google")
    .maybeSingle();

  return json({
    results,
    google: g ? { email: g.connected_email, connectedAt: g.connected_at } : null,
  });
});

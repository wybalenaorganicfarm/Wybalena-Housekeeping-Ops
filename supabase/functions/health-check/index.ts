// health-check — cron: daily 07:00 IST testing (01:30 UTC); go-live tz TBD.
// Probes every external connection with READ-ONLY calls (no messages/emails are
// triggered) and emails an alert listing any broken connection.
//
// Connections checked:
//   - supabase  : a trivial DB read via the service-role client
//   - whapi     : GET /health (channel reachable)
//   - gmail     : users.getProfile (token valid, send scope account live)
//   - google_calendar : calendars.get (token valid, calendar readable)
//
// A connection with missing creds reports configured:false and is NOT treated
// as a failure (the adapter is intentionally stubbed until creds are wired).
// Only configured-but-failing connections raise the alert.
//
// Recipient: HEALTHCHECK_ALERT_TO (set this to Yashasvi's address), falling back
// to ALERT_EMAIL_TO (Ashleigh).
//
// CAVEAT: if Gmail itself is the broken connection the alert email cannot be
// delivered — the failure is also console.error'd and returned in the response
// so it surfaces in Supabase function logs / log-based alerting.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { checkHealth as checkWhapi } from "../_shared/adapters/whatsapp.ts";
import { checkHealth as checkGmail } from "../_shared/adapters/email.ts";
import { checkHealth as checkCalendar } from "../_shared/adapters/calendar.ts";

interface HealthResult {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

async function checkSupabase(): Promise<HealthResult> {
  try {
    const sb = serviceClient();
    // Trivial read — confirms DB + service-role key are working. No writes.
    const { error } = await sb
      .from("cleaners")
      .select("id", { count: "exact", head: true });
    return {
      name: "supabase",
      configured: true,
      ok: !error,
      detail: error ? error.message : "database reachable, service role valid",
    };
  } catch (e) {
    return { name: "supabase", configured: true, ok: false, detail: String(e) };
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  // Run all probes concurrently. All are read-only.
  const results: HealthResult[] = await Promise.all([
    checkSupabase(),
    checkWhapi(),
    checkGmail(),
    checkCalendar(),
  ]);

  const broken = results.filter((r) => r.configured && !r.ok);
  const unconfigured = results.filter((r) => !r.configured).map((r) => r.name);

  if (broken.length > 0) {
    const lines = broken.map((b) => ` • ${b.name}: ${b.detail}`).join("\n");
    console.error(`[health-check] BROKEN CONNECTIONS:\n${lines}`);
    await sendEmail(
      `Wybalena ALERT: ${broken.length} connection(s) not working`,
      `The daily connection check found problem(s) that need attention:\n\n${lines}\n\n` +
        (unconfigured.length ? `(Not yet configured, skipped: ${unconfigured.join(", ")})\n\n` : "") +
        `Please look into it.`,
      Deno.env.get("HEALTHCHECK_ALERT_TO") ?? undefined,
    );
  }

  return json({
    ok: broken.length === 0,
    checkedAt: new Date().toISOString(),
    results,
    broken: broken.map((b) => b.name),
    unconfigured,
  });
});

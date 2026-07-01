// manage-cron — app-facing. Powers the Automation Schedule page (/schedule).
// Reads and reschedules the managed pg_cron jobs (wy-*) via SECURITY DEFINER
// RPCs (see 20260701120000_cron_management.sql). cron.job is not reachable over
// PostgREST, so all cron access is funnelled through those wrappers.
//
// action: "list"   → { jobs: [{ fn, schedule, active }] }
// action: "update" → reschedule one known job; { fn, schedule, active }
//
// Caller must be a writer (admin / super_admin). The set of schedulable
// functions is allow-listed here so a client can only touch known jobs.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

// The complete set of scheduled jobs (matches 20260625100100_cron.sql).
const KNOWN_FNS = new Set([
  "sync-bookings", "confirm-reminder", "offer-tier-1", "remind-nonresponders",
  "escalate-tier-2", "escalate-tier-3", "pre-shift-reminder", "cancellation-followup",
  "health-check", "wipeover-notify",
]);

// Guard: "m h dom mon dow", each field digits / * / , / - / /. Keeps obviously
// malformed input out of cron.schedule; the RPC still owns the command string.
const CRON_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;
const FIELD_RE = /^[\d*,\-/]+$/;
function validCron(expr: unknown): expr is string {
  if (typeof expr !== "string") return false;
  const m = expr.trim().match(CRON_RE);
  return !!m && m.slice(1).every((f) => FIELD_RE.test(f));
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { action, fn, schedule, active } = await req.json().catch(() => ({}));

  if (action === "list") {
    const { data, error } = await sb.rpc("admin_list_cron_jobs");
    if (error) return json({ error: error.message }, 400);
    return json({ jobs: data ?? [] });
  }

  if (action === "update") {
    if (!KNOWN_FNS.has(fn)) return json({ error: "unknown function" }, 400);
    if (!validCron(schedule)) return json({ error: "invalid cron expression" }, 400);
    const enabled = active !== false;

    const { error } = await sb.rpc("admin_set_cron_schedule", {
      p_fn: fn, p_schedule: String(schedule).trim(), p_active: enabled,
    });
    if (error) return json({ error: error.message }, 400);

    const { data: me } = await sb.from("profiles").select("full_name").eq("id", caller.userId).maybeSingle();
    const who = me?.full_name ?? "An admin";
    await writeAuditLog(sb, {
      event_type: "schedule.updated",
      event_label: "Schedule Updated",
      status: "success",
      summary: `${who} rescheduled "${fn}" to ${schedule}${enabled ? "" : " (paused)"}.`,
      detail: { fn, schedule, active: enabled, by: caller.userId },
      source: "manage-cron",
      triggered_by: "manual",
    });
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});

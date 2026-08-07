// remind-nonresponders — RETIRED, replaced by the per-tier jobs remind-tier-1 /
// remind-tier-2 / remind-tier-3 (each independently schedulable from /schedule).
//
// Its cron job is unscheduled by 20260805160000_per_tier_reminders.sql. This
// stub stays deployed so any lingering invocation is a harmless no-op rather
// than a second reminder pass on top of the per-tier jobs.
import { handleOptions, json } from "../_shared/http.ts";

Deno.serve((req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  return json({
    ok: true,
    reminded: 0,
    retired: "Use remind-tier-1 / remind-tier-2 / remind-tier-3 instead.",
  });
});

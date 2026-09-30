// cancellation-reoffer — cron (daily, 3pm venue time). Sweeps shifts a
// cancellation left with a freed spot that was DEFERRED rather than re-offered on
// the spot (reoffer_pending_at set by engine.cancelOffer). For each, it resumes
// the tier chain — offer the next tier that still has cleaners, or, once every
// tier is spent, re-ask everyone still available — then clears the mark.
//
// WHY 3pm and not immediately: the venue asked that a cancellation with plenty of
// notice not ping cleaners at whatever random hour it happened. Batching to 3pm
// means these go out with the day's normal tier offers. A cancellation within the
// urgent window (default 72h) never reaches here — cancelOffer re-offers it
// immediately and leaves no pending mark.
//
// Independently schedulable from the /schedule page like every other cron. The
// per-shift work lives in engine.resumePendingReoffer so this file only sweeps.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { resumePendingReoffer } from "../_shared/engine.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "cancellation-reoffer";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  const { data: pending } = await sb
    .from("shifts")
    .select("id, shift_date, start_time")
    .not("reoffer_pending_at", "is", null)
    .neq("status", "cancelled")
    .order("shift_date");

  const rows = pending ?? [];
  let handled = 0;
  let offered = 0;
  const notes: string[] = [];

  for (const s of rows) {
    try {
      const r = await resumePendingReoffer(sb, s.id);
      if (r.action === "nothing") continue;
      handled++;
      offered += r.offered;
      const when = prettyDate(s.shift_date);
      notes.push(
        r.action === "escalated"
          ? `${when}: escalated to ${r.tier?.replace("tier_", "Tier ")} (${r.offered} offered).`
          : `${when}: re-offered to everyone available (${r.offered} offered).`,
      );
    } catch (e) {
      console.error(`[cancellation-reoffer] failed for shift ${s.id}: ${String(e)}`);
    }
  }

  await writeAuditLog(sb, {
    event_type: handled > 0 ? "cancellation_reoffer.run" : "cancellation_reoffer.skipped",
    event_label: "Cancellation Re-Offer",
    status: handled > 0 ? "success" : "skipped",
    summary: handled > 0
      ? `Re-offered ${handled} shift(s) held from earlier cancellations: ${notes.join(" ")}`
      : "No shifts were waiting on a deferred cancellation re-offer.",
    detail: { pending: rows.length, handled, offered },
    source: SOURCE,
    triggered_by: "cron",
  });

  return json({ ok: true, pending: rows.length, handled, offered });
});

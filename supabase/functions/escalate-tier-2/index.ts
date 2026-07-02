// escalate-tier-2 — cron (admin-scheduled). Any shift still in Tier-1 staffing ->
// offer Tier 2. No internal delay: the admin controls the spacing after Tier 1 via
// this job's schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyManagerSummary, type ShiftOfferSummary } from "../_shared/managerSummary.ts";

const SOURCE = "escalate-tier-2";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Every shift still in Tier-1 staffing. No internal age gate — the admin decides
  // when to escalate purely through this job's schedule.
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time")
    .eq("status", "staffing")
    .eq("current_tier", "tier_1");

  let escalated = 0;
  const summaries: ShiftOfferSummary[] = [];
  for (const s of shifts ?? []) {
    try {
      const res = await offerTier(sb, s.id, "tier_2");
      if (res.count > 0) {
        escalated += res.count;
        summaries.push({
          shiftDate: res.shiftDate,
          startTime: (s.start_time ?? "").slice(0, 5),
          shiftType: s.shift_type,
          names: res.offered.map((c) => c.full_name),
        });
        const names = res.offered.map((c) => c.full_name).join(", ");
        await writeAuditLog(sb, {
          event_type: "escalation.tier2_triggered",
          event_label: "Tier 2 Escalation",
          status: "success",
          summary: `Tier 2 escalation triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled. Tier 2 offers sent to: ${names}.`,
          detail: { shift_id: s.id, open_spots: res.openSpots, count: res.count, cleaners: res.offered },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "escalation.tier2_triggered",
        event_label: "Tier 2 Escalation",
        status: "failed",
        summary: `Tier 2 escalation failed for shift on ${s.shift_date}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  if (escalated === 0) {
    const tier1Count = shifts?.length ?? 0;
    const summary = tier1Count === 0
      ? "No shifts are in Tier 1 staffing. All confirmed shifts are staffed or not yet offered — no Tier 2 escalation needed."
      : `${tier1Count} shift(s) in Tier 1 staffing, but no available Tier 2 cleaner to offer.`;
    await writeAuditLog(sb, {
      event_type: "escalation.tier2_skipped",
      event_label: "Tier 2 Escalation",
      status: "skipped",
      summary,
      detail: { in_tier1_staffing: tier1Count },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  // Per-shift summary to Zara (team leader).
  await notifyManagerSummary(sb, "tier_2", summaries, escalated, SOURCE);

  return json({ ok: true, escalatedOffers: escalated });
});

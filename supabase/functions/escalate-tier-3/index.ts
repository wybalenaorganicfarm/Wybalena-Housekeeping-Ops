// escalate-tier-3 — cron (admin-scheduled). Any shift still in Tier-2 staffing ->
// offer Tier 3 + raise understaffed_urgent alert + urgent email to Ashley. No
// internal delay: the admin controls the spacing after Tier 2 via this job's
// schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyManagerSummary, type ShiftOfferSummary } from "../_shared/managerSummary.ts";

const SOURCE = "escalate-tier-3";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Every shift still in Tier-2 staffing. No internal age gate — the admin decides
  // when to escalate to Tier 3 purely through this job's schedule.
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time")
    .eq("status", "staffing")
    .eq("current_tier", "tier_2");

  let escalated = 0;
  let totalOffers = 0;
  const summaries: ShiftOfferSummary[] = [];
  for (const s of shifts ?? []) {
    try {
      const res = await offerTier(sb, s.id, "tier_3");
      escalated++;
      if (res.count > 0) {
        totalOffers += res.count;
        summaries.push({
          shiftDate: res.shiftDate,
          startTime: (s.start_time ?? "").slice(0, 5),
          shiftType: s.shift_type,
          names: res.offered.map((c) => c.full_name),
        });
      }

      // Raise urgent alert (dedupe one open per shift) + urgent email.
      const { data: dup } = await sb
        .from("alerts")
        .select("id")
        .eq("alert_type", "understaffed_urgent")
        .eq("shift_id", s.id)
        .eq("status", "open")
        .maybeSingle();
      if (!dup) {
        await sb.from("alerts").insert({
          alert_type: "understaffed_urgent",
          shift_id: s.id,
          title: "Tier 3 reached — understaffed",
          body: `${s.shift_type} on ${s.shift_date} reached Tier 3 and still has open spots. Intervene manually.`,
        });
      }
      await sendEmail(
        "Wybalena URGENT: shift understaffed at Tier 3",
        `The ${s.shift_type} shift on ${s.shift_date} has reached Tier 3 and is still ` +
          `not fully staffed. Please assign cleaners manually.`,
        (await opsManager(sb)).email ?? undefined,
      );

      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: "warning",
        summary: `Tier 3 escalation triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled after Tier 2. Tier 3 offers sent. Ashley notified urgently.`,
        detail: { shift_id: s.id, open_spots: res.openSpots, count: res.count, cleaners: res.offered },
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: "failed",
        summary: `Tier 3 escalation failed for shift on ${s.shift_date}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  if (escalated === 0) {
    await writeAuditLog(sb, {
      event_type: "escalation.tier3_skipped",
      event_label: "Tier 3 Escalation",
      status: "skipped",
      summary: "No shifts are in Tier 2 staffing. All shifts are staffed or not yet at Tier 2 — no Tier 3 escalation needed.",
      detail: { in_tier2_staffing: shifts?.length ?? 0 },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  // Per-shift summary to Zara (team leader).
  await notifyManagerSummary(sb, "tier_3", summaries, totalOffers, SOURCE);

  return json({ ok: true, escalatedShifts: escalated });
});

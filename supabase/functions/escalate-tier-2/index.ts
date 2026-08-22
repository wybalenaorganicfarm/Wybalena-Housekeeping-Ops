// escalate-tier-2 — cron (admin-scheduled). Any shift still in Tier-1 staffing ->
// offer Tier 2. No internal delay: the admin controls the spacing after Tier 1 via
// this job's schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { nextOfferableTier, offerTier, tierChain } from "../_shared/engine.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyOfferFailure, type OfferFailure } from "../_shared/managerSummary.ts";

const SOURCE = "escalate-tier-2";

// Display names only — the chain itself comes from the roster, not from here.
// An unknown tier falls back to its raw value so adding one can't break logging.
const TIER_WORD: Record<string, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };
const word = (t: string) => TIER_WORD[t] ?? t;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Every WEEKLY-track shift still sitting at the FIRST tier of the chain. Not
  // hard-coded to 'tier_1': the chain is whatever tiers the roster actually has,
  // so this job means "take the first step", whatever that step is called.
  //
  // No internal age gate — the admin decides when to escalate purely through
  // this job's schedule. Shifts on the 'catchup' track are escalated by
  // staffing-catchup on its own 24h clock and must not be touched here, or both
  // chains drive the same shift.
  const chain = await tierChain(sb);
  if (chain.length === 0) return json({ ok: true, escalatedOffers: 0 });

  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time, current_tier")
    .eq("status", "staffing")
    .eq("current_tier", chain[0])
    .eq("staffing_track", "weekly")
    // Soonest shift first — this loop sends in sequence, and unordered rows come
    // back in physical storage order, which is not chronological.
    .order("shift_date")
    .order("start_time");

  let escalated = 0;
  const failures: OfferFailure[] = [];
  for (const s of shifts ?? []) {
    try {
      // The next tier that actually has someone free for this shift — which may
      // not be the one immediately below. A tier with nobody in it, or whose
      // cleaners are all already on the shift, is stepped over rather than
      // stranding the shift here for good.
      const next = await nextOfferableTier(sb, s.id, s.current_tier ?? chain[0]);
      if (!next) {
        await writeAuditLog(sb, {
          event_type: "escalation.tier2_skipped",
          event_label: "Tier 2 Escalation",
          status: "skipped",
          summary: `Shift on ${s.shift_date} has no tier left to escalate to — every cleaner has already been offered it. Assign manually.`,
          detail: { shift_id: s.id, from: s.current_tier },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
        continue;
      }
      const res = await offerTier(sb, s.id, next);
      if (res.count > 0) {
        escalated += res.count;
        const names = res.offered.map((c) => c.full_name).join(", ");
        await writeAuditLog(sb, {
          event_type: "escalation.tier2_triggered",
          event_label: "Tier 2 Escalation",
          status: "success",
          summary: `Escalation to ${word(next)} triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled. ${word(next)} offers sent to: ${names}.`,
          detail: { shift_id: s.id, tier: next, open_spots: res.openSpots, count: res.count, cleaners: res.offered },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
      if (res.failed > 0) {
        failures.push({
          shiftDate: res.shiftDate,
          startTime: (s.start_time ?? "").slice(0, 5),
          shiftType: s.shift_type,
          names: res.failedNames,
        });
        await writeAuditLog(sb, {
          event_type: "escalation.tier2_triggered",
          event_label: "Tier 2 Escalation",
          status: "failed",
          summary: `Tier 2 offers for shift on ${s.shift_date} could NOT be sent to ${res.failedNames.join(", ")} — the WhatsApp channel needs reconnecting. No offer delivered.`,
          error_message: "whatsapp send failed",
          detail: { shift_id: s.id, failed: res.failed, cleaners: res.failedNames },
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

  await notifyOfferFailure(sb, "tier_2", failures, SOURCE);

  if (escalated === 0 && failures.length === 0) {
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

  return json({ ok: true, escalatedOffers: escalated });
});

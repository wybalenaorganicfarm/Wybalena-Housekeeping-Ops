// escalate-tier-3 — cron (admin-scheduled, daily, runs AFTER remind-tier-3).
// Two passes:
//   1. Delayed understaffed alert — a shift that reached the last tier is alerted
//      only once its last-tier offer is >=1 venue-day old, so Tier 3 cleaners get
//      the initial WhatsApp AND the next-morning remind-tier-3 reminder (20:00 UTC,
//      earlier the same day) before a human is pulled in. The alert is no longer
//      raised at the moment of escalation.
//   2. Escalation — any shift still in Tier-2 staffing is offered Tier 3. The admin
//      controls the spacing after Tier 2 via this job's schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { acceptedCount, daysSinceCurrentTierOffer, nextOfferableTier, offerTier, tierChain } from "../_shared/engine.ts";
import { raiseTier3Alert } from "../_shared/tier3Alert.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "escalate-tier-3";

// Display names for the tiers we ship with. An unknown tier falls back to its
// raw value, so adding one to the enum can't break the messaging.
const TIER_WORD: Record<string, string> = {
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
};

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Every shift that has moved PAST the first tier and still has somewhere to
  // go, on EITHER track. Not hard-coded to 'tier_2': this job means "take the
  // next step", so with a fourth tier on the roster it advances tier_3 -> tier_4
  // as well, without a fourth cron job.
  //
  // Both tracks are escalated here now — catch-up shifts included — so their
  // escalation happens at the admin's Schedule-tab time, not on the daily
  // staffing-catchup slot. staffing-catchup no longer escalates. The one-day
  // minimum gate (daysSinceCurrentTierOffer) stops a catch-up shift being
  // stepped twice in a day; weekly shifts are always older, so it never delays
  // them.
  const chain = await tierChain(sb);
  if (chain.length < 2) return json({ ok: true, escalatedOffers: 0 });
  const lastTier = chain[chain.length - 1] as "tier_1" | "tier_2" | "tier_3";

  // ── Pass 1: delayed understaffed alert ────────────────────────────────────
  // A shift qualifies once ALL hold: still staffing, sitting at the last tier,
  // still has open spots, and its last-tier offer is >=1 venue-day old. The
  // day-old gate is the 24h window — measured from shift_assignments.offered_at
  // via daysSinceCurrentTierOffer, DST-safe on this fixed daily slot (an hours
  // gate would slip a day — see staffing-catchup). raiseTier3Alert dedupes one
  // open alert per shift and emails only alongside a newly-raised one, so a
  // shift already alerted, or staffed in the meantime, is never re-alerted.
  const { data: lastTierShifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, required_cleaners")
    .eq("status", "staffing")
    .eq("current_tier", lastTier);
  for (const s of lastTierShifts ?? []) {
    try {
      if (await daysSinceCurrentTierOffer(sb, s.id, lastTier) < 1) continue;
      if ((s.required_cleaners - await acceptedCount(sb, s.id)) <= 0) continue;
      await raiseTier3Alert(sb, s);
    } catch (e) {
      console.error(`[escalate-tier-3] delayed alert check failed for ${s.id}: ${String(e)}`);
    }
  }

  // ── Pass 2: escalation ─────────────────────────────────────────────────────
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time, current_tier")
    .eq("status", "staffing")
    .in("current_tier", chain.slice(1))
    .in("staffing_track", ["weekly", "catchup"])
    // Soonest shift first — this loop sends in sequence, and unordered rows come
    // back in physical storage order, which is not chronological.
    .order("shift_date")
    .order("start_time");

  let escalated = 0;
  for (const s of shifts ?? []) {
    try {
      // At least one venue-local day at this tier since its last offer here,
      // so a catch-up shift adopted today isn't stepped again the same day.
      if (await daysSinceCurrentTierOffer(sb, s.id, (s.current_tier ?? chain[1]) as "tier_1" | "tier_2" | "tier_3") < 1) continue;
      // The next tier with someone free for this shift, stepping over any that
      // is empty or already fully on the shift. Null = the chain is spent; the
      // shift is handled by Pass 1's delayed understaffed alert once its last-tier
      // offer is a day old, so leave it alone here rather than re-processing it.
      const next = await nextOfferableTier(sb, s.id, s.current_tier ?? null);
      if (!next) continue;
      const res = await offerTier(sb, s.id, next);
      // Count only real deliveries, matching escalate-tier-2 — a tier with nobody
      // free (count 0) or a failed send must not inflate the escalation summary.
      if (res.count > 0) escalated += res.count;

      // The urgent understaffed alert is NO LONGER raised here at the moment of
      // escalation — Pass 1 raises it 24h later (once the offer is >=1 day old),
      // after Tier 3 cleaners have had the reminder. This pass only sends offers.
      const word = TIER_WORD[next] ?? next;

      // Report what actually reached cleaners — a failed WhatsApp send must not be
      // logged as "offers sent".
      const deliveryNote = res.failed > 0
        ? `${word} offers to ${res.failedNames.join(", ")} could NOT be sent — the WhatsApp channel needs reconnecting.`
        : res.count > 0
          ? `${word} offers sent to ${res.offered.map((c) => c.full_name).join(", ")}.`
          : `No ${word} cleaner was available to offer.`;
      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: res.failed > 0 ? "failed" : "warning",
        summary: `Escalation to ${word} triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled. ${deliveryNote}`,
        detail: { shift_id: s.id, open_spots: res.openSpots, count: res.count, cleaners: res.offered, failed: res.failed, failed_cleaners: res.failedNames },
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

  return json({ ok: true, escalatedShifts: escalated });
});

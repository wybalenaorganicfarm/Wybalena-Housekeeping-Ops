// escalate-tier-3 — cron (admin-scheduled, daily). MUST run AFTER remind-tier-3
// on any given venue day, because Pass 1 now gates the understaffed alert on the
// Tier 3 reminder having been sent. Keep escalate-tier-3's Schedule-tab time
// LATER than remind-tier-3's. If it is ever set earlier, the alert simply waits
// until the next escalation run that follows a reminder — a safe delay, never an
// early fire — and the 2-day backstop in Pass 1 guarantees it still lands.
// Two passes:
//   1. Delayed understaffed alert — a shift that reached the last tier is alerted
//      only once its Tier 3 cleaners have been REMINDED (remind-tier-3 has stamped
//      reminder_sent_at on every open offer), so they get the initial WhatsApp AND
//      the follow-up reminder, with a chance to respond, before a human is pulled
//      in. Backstopped at >=2 venue-days so a reminder that never sends can't
//      suppress the alert forever. Not raised at the moment of escalation.
//   2. Escalation — any shift still in Tier-2 staffing is offered Tier 3. The admin
//      controls the spacing after Tier 2 via this job's schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { acceptedCount, allCurrentTierOffersReminded, daysSinceCurrentTierOffer, nextOfferableTier, offerTier, tierChain } from "../_shared/engine.ts";
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
  // still has open spots, and its last-tier cleaners have already been REMINDED.
  //
  // The gate is "the tier's non-responder reminder has gone out" — not merely
  // "24h since the offer". The venue wants Tier 3 cleaners to receive the initial
  // offer AND the follow-up reminder, with a chance to respond to the reminder,
  // before a human is pulled in. allCurrentTierOffersReminded() is true only once
  // every still-open Tier 3 offer has reminder_sent_at set (remind-tier-3 runs
  // earlier, at its own admin-set slot).
  //
  // SAFETY BACKSTOP: if a reminder never sends (WhatsApp outage, a cleaner with
  // no phone — remindTier skips those without stamping), gating on the reminder
  // alone would suppress the alert forever. So the alert also fires once the
  // offer is >=2 venue-days old regardless, guaranteeing a human is eventually
  // told. In normal operation the reminder lands first and the alert follows it.
  //
  // raiseTier3Alert dedupes one open alert per shift and emails only alongside a
  // newly-raised one, so a shift already alerted, or staffed in the meantime, is
  // never re-alerted.
  const REMINDER_BACKSTOP_DAYS = 2;
  const { data: lastTierShifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, required_cleaners")
    .eq("status", "staffing")
    .eq("current_tier", lastTier)
    // Same scope as Pass 2 below. Without this, a shift with no staffing_track
    // (reachable via a manual offer on an already-`staffing` shift) was alerted
    // and emailed as URGENT here while Pass 2 never escalated it — a recurring
    // alert for a shift this job does not otherwise act on.
    .in("staffing_track", ["weekly", "catchup"]);
  for (const s of lastTierShifts ?? []) {
    try {
      if ((s.required_cleaners - await acceptedCount(sb, s.id)) <= 0) continue;
      const reminded = await allCurrentTierOffersReminded(sb, s.id, lastTier);
      const overdue = await daysSinceCurrentTierOffer(sb, s.id, lastTier) >= REMINDER_BACKSTOP_DAYS;
      if (!reminded && !overdue) continue;
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

// escalate-tier-3 — cron (admin-scheduled). Any shift still in Tier-2 staffing ->
// offer Tier 3 + raise understaffed_urgent alert + urgent email to Ashleigh. No
// internal delay: the admin controls the spacing after Tier 2 via this job's
// schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { nextOfferableTier, offerTier, tierChain } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { opsManager } from "../_shared/admin.ts";
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

  // Every WEEKLY-track shift that has moved PAST the first tier and still has
  // somewhere to go. Not hard-coded to 'tier_2': this job means "take the next
  // step", so with a fourth tier on the roster it advances tier_3 -> tier_4 as
  // well, without a fourth cron job.
  //
  // No internal age gate — the admin decides when to escalate purely through
  // this job's schedule. Shifts on the 'catchup' track are escalated by
  // staffing-catchup instead.
  const chain = await tierChain(sb);
  if (chain.length < 2) return json({ ok: true, escalatedOffers: 0 });

  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time, current_tier")
    .eq("status", "staffing")
    .in("current_tier", chain.slice(1))
    .eq("staffing_track", "weekly")
    // Soonest shift first — this loop sends in sequence, and unordered rows come
    // back in physical storage order, which is not chronological.
    .order("shift_date")
    .order("start_time");

  let escalated = 0;
  for (const s of shifts ?? []) {
    try {
      // The next tier with someone free for this shift, stepping over any that
      // is empty or already fully on the shift. Null = the chain is spent; the
      // shift was alerted on when it reached the last tier, so leave it alone
      // rather than re-emailing Ashleigh about it every week.
      const next = await nextOfferableTier(sb, s.id, s.current_tier ?? null);
      if (!next) continue;
      const res = await offerTier(sb, s.id, next);
      escalated++;

      // Only the LAST tier in the chain is the "nothing left after this" moment
      // that warrants the urgent alert — with a fourth tier on the roster, being
      // moved to tier_3 is no longer the end of the road.
      const lastTier = next === chain[chain.length - 1];
      const word = TIER_WORD[next] ?? next;

      if (lastTier) {
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
            title: `${word} reached — understaffed`,
            body: `${s.shift_type} on ${s.shift_date} reached ${word}, the last tier, and still has open spots. Intervene manually.`,
          });
        }
        await sendEmail(
          `Wybalena URGENT: shift understaffed at ${word}`,
          `The ${s.shift_type} shift on ${s.shift_date} has reached ${word}, the last tier, ` +
            `and is still not fully staffed. Please assign cleaners manually.`,
          (await opsManager(sb)).email ?? undefined,
        );
      }

      // Report what actually reached cleaners — a failed WhatsApp send must not be
      // logged as "offers sent". Ashleigh is already emailed urgently above either way.
      const deliveryNote = res.failed > 0
        ? `${word} offers to ${res.failedNames.join(", ")} could NOT be sent — the WhatsApp channel needs reconnecting.`
        : res.count > 0
          ? `${word} offers sent to ${res.offered.map((c) => c.full_name).join(", ")}.`
          : `No ${word} cleaner was available to offer.`;
      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: res.failed > 0 ? "failed" : "warning",
        summary: `Escalation to ${word} triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled. ${deliveryNote}${lastTier ? " Ashleigh notified urgently." : ""}`,
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

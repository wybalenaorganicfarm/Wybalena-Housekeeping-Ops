// staffing-catchup — cron (daily). Safety net for the weekly offer/escalation
// chain.
//
// The weekly jobs (offer-tier-1, escalate-tier-2/3) only fire on their own cron
// slots. If the Operations Manager misses the Monday confirmation email and
// confirms a shift later in the week, that shift is not offered until the NEXT
// weekly run — up to 7 days lost on a shift that may be days away.
//
// This job runs daily and advances anything that has fallen behind, using each
// shift's OWN elapsed time rather than the weekly slots:
//   • confirmed, never offered            -> Tier 1 offers now
//   • at Tier 1, wait elapsed, still short -> escalate to Tier 2
//   • at Tier 2, wait elapsed, still short -> escalate to Tier 3
//
// The escalation clock counts VENUE-LOCAL CALENDAR DAYS since the shift's most
// recent offer (shift_assignments.offered_at) — not elapsed hours. This job runs
// on one fixed daily slot, and an hours-based gate can never clear on that slot:
// `offered_at` is stamped a fraction of a second AFTER the run captures its own
// clock, so the next day's comparison is always a few hundred milliseconds short
// of 24h, skips, and the escalation slips to 48h. Counting days instead makes
// Tier 1 Monday → Tier 2 Tuesday → Tier 3 Wednesday exact, whatever the latency.
// The time of day is simply whenever this job is scheduled to run.
//
// Deliberately scoped to this job. The weekly offer/escalation chain keeps
// working purely off its own cron slots on /schedule. The wait (in days) is
// editable from /schedule (app_settings.staffing_catchup).
//
// Idempotent by construction: a shift already at the right tier for its elapsed
// time is skipped, so running this alongside the weekly jobs never double-offers.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { loadStaffingCatchup } from "../_shared/settings.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyOfferFailure, type OfferFailure } from "../_shared/managerSummary.ts";
import { daysBetweenDays, prettyDate, venueDay } from "../_shared/datetime.ts";

const SOURCE = "staffing-catchup";
const HOUR = 3600000;

type Tier = "tier_1" | "tier_2" | "tier_3";
const NEXT_TIER: Record<string, Tier> = { tier_1: "tier_2", tier_2: "tier_3" };

interface ShiftRow {
  id: string;
  shift_date: string;
  shift_type: string;
  start_time: string;
  status: string;
  current_tier: string | null;
  confirmed_at: string | null;
}

// When this shift was most recently offered to anyone — the clock the escalation
// wait is measured against. Null when it has never been offered.
async function lastOfferedAt(sb: ReturnType<typeof serviceClient>, shiftId: string): Promise<Date | null> {
  const { data } = await sb
    .from("shift_assignments")
    .select("offered_at")
    .eq("shift_id", shiftId)
    .order("offered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = (data as { offered_at?: string } | null)?.offered_at;
  return at ? new Date(at) : null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const { escalationWaitDays, offerGraceHours } = await loadStaffingCatchup(sb);
  const now = Date.now();
  // Today in venue-local terms — the only unit the escalation gate compares.
  const today = venueDay(new Date(now));

  // Everything still being staffed: confirmed-but-unoffered, plus anything
  // sitting at Tier 1 or Tier 2. Shifts already at Tier 3 have nowhere left to
  // escalate to; fully_staffed and cancelled are excluded.
  //
  // Ordered by date because this loop sends in sequence: without it Postgres
  // returns rows in physical storage order — roughly insertion order, and not
  // even that once rows are updated — so a batch arrived as 16 Sept, 21 Sept,
  // 7 Sept. Soonest shift first is both chronological and the right priority.
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, start_time, status, current_tier, confirmed_at")
    .in("status", ["confirmed", "staffing"])
    .order("shift_date")
    .order("start_time");

  let firstOffers = 0;
  let escalations = 0;
  let skipped = 0;
  const failures: OfferFailure[] = [];
  const actions: string[] = [];

  for (const s of (shifts ?? []) as ShiftRow[]) {
    // Decide what this shift is owed, if anything.
    let tier: Tier | null = null;
    let reason = "";

    if (s.status === "confirmed") {
      // Confirmed but never offered — the missed-email case. A grace period is
      // supported but defaults to 0, so normally it goes out on the next run.
      const confirmedAt = s.confirmed_at ? new Date(s.confirmed_at).getTime() : 0;
      if (offerGraceHours > 0 && confirmedAt && now - confirmedAt < offerGraceHours * HOUR) {
        skipped++;
        continue;
      }
      tier = "tier_1";
      reason = "confirmed but never offered";
    } else if (s.current_tier === "tier_1" || s.current_tier === "tier_2") {
      const offeredAt = await lastOfferedAt(sb, s.id);
      // No offer on record despite the status — re-offer at the current tier
      // rather than leaving it stuck.
      if (!offeredAt) {
        tier = s.current_tier as Tier;
        reason = `at ${s.current_tier} with no offer on record`;
      } else {
        // Whole venue-local days between the last offer's day and today. An offer
        // made earlier in THIS run counts as 0, so a shift is never escalated on
        // the same day it was offered.
        const offerDay = venueDay(offeredAt);
        if (daysBetweenDays(offerDay, today) >= escalationWaitDays) {
          tier = NEXT_TIER[s.current_tier];
          reason = `no response since the ${s.current_tier.replace("_", " ")} offer on ${prettyDate(offerDay)}`;
        } else {
          skipped++;  // offered today, or still inside a longer wait — leave it
          continue;
        }
      }
    } else {
      skipped++;  // tier_3, or staffing with no tier set
      continue;
    }

    try {
      const res = await offerTier(sb, s.id, tier);
      if (res.count > 0) {
        if (tier === "tier_1" && s.status === "confirmed") firstOffers += res.count;
        else escalations += res.count;
        const names = res.offered.map((c) => c.full_name).join(", ");
        actions.push(`${prettyDate(s.shift_date)} → ${tier.replace("_", " ")} (${res.count})`);
        await writeAuditLog(sb, {
          event_type: "staffing.caught_up",
          event_label: "Staffing Catch-Up",
          status: "success",
          summary: `Catch-up: shift on ${prettyDate(s.shift_date)} offered to ${tier.replace("_", " ")} — ${reason}. ${res.count} cleaner(s) offered: ${names}.`,
          detail: { shift_id: s.id, tier, reason, count: res.count, cleaners: res.offered },
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
          event_type: "staffing.caught_up",
          event_label: "Staffing Catch-Up",
          status: "failed",
          summary: `Catch-up offers for shift on ${prettyDate(s.shift_date)} could NOT be sent to ${res.failedNames.join(", ")} — the WhatsApp channel needs reconnecting. No offer delivered.`,
          error_message: "whatsapp send failed",
          detail: { shift_id: s.id, tier, failed: res.failed, cleaners: res.failedNames },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
      if (res.count === 0 && res.failed === 0) skipped++;
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "staffing.caught_up",
        event_label: "Staffing Catch-Up",
        status: "failed",
        summary: `Catch-up failed for shift on ${prettyDate(s.shift_date)}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  // One consolidated email if any sends bounced, same as the weekly jobs.
  await notifyOfferFailure(sb, "tier_1", failures, SOURCE);

  const moved = firstOffers + escalations;
  if (moved === 0 && failures.length === 0) {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_skipped",
      event_label: "Staffing Catch-Up",
      status: "skipped",
      summary: `Nothing to catch up. ${skipped} shift(s) checked and all are on track.`,
      detail: { checked: (shifts ?? []).length, skipped, escalation_wait_days: escalationWaitDays },
      source: SOURCE,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_run",
      event_label: "Staffing Catch-Up",
      status: "success",
      summary: `Catch-up moved ${moved} offer(s) forward: ${firstOffers} first offer(s) for shifts confirmed late, ${escalations} escalation(s). ${actions.join("; ")}.`,
      detail: { firstOffers, escalations, skipped, escalation_wait_days: escalationWaitDays, actions },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, firstOffers, escalations, skipped });
});

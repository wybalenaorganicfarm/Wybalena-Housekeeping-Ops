// staffing-catchup — cron (daily). Owns the ENTIRE staffing chain for shifts that
// were confirmed too late to catch the weekly Tier 1 slot.
//
// Two chains, never crossed (shifts.staffing_track — see
// supabase/migrations/20260819120000_staffing_track.sql):
//
//   'weekly'  — offered by offer-tier-1 on its Monday slot. Every later step comes
//               from the /schedule cron jobs:
//                 Mon 15:00 offer T1 -> Tue 09:00 remind T1 -> Tue 15:00 open T2
//                 -> Wed 09:00 remind T2 -> Wed 15:00 open T3 -> Thu 09:00 remind T3
//               THIS JOB NEVER TOUCHES THEM.
//
//   'catchup' — adopted here because the Operations Manager confirmed the shift
//               after the weekly slot had already run, and waiting for the next
//               one would burn up to 7 days on a shift that may be days away.
//               This job then runs the SAME sequence for that shift on its own
//               clock, one step per run:
//                 offer T1 -> remind T1 -> open T2 -> remind T2 -> open T3 -> remind T3
//               THE WEEKLY JOBS NEVER TOUCH THEM.
//
// Before this split both chains drove every shift. A mid-week shift was raced
// through all three tiers by this job in ~48h while its Tier-1 offer was left
// sitting `offered` and unreminded; the weekly remind-tier-1 job only fires once
// a week, so weeks of those orphaned rows piled up and fired in a single burst.
// That is the flood of duplicate reminders the client received on 17 August.
//
// The clock counts VENUE-LOCAL CALENDAR DAYS since the previous step, not elapsed
// hours. This job runs on one fixed daily slot, and an hours-based gate can never
// clear on that slot: the previous step's timestamp is stamped a fraction of a
// second AFTER the run captured its own clock, so the next day's comparison is
// always a few hundred milliseconds short of 24h, skips, and slips to 48h.
// Counting days makes offer Monday -> remind Tuesday -> Tier 2 Wednesday exact,
// whatever the run latency. The time of day is simply when this job is scheduled.
//
// The wait (in days) is editable from /schedule (app_settings.staffing_catchup).
//
// The run is decide-then-act: every shift's next step is worked out first, then
// all the reminders are sent in one batch. That batching matters — it is what
// lets a cleaner owed reminders on several catch-up shifts receive ONE message
// instead of one per shift.
//
// Idempotent by construction: each step is gated on the timestamp the PREVIOUS
// step wrote, and each shift advances at most one step per run.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier, type Tier } from "../_shared/engine.ts";
import { remindShiftsAtTier } from "../_shared/remindTier.ts";
import { raiseTier3Alert } from "../_shared/tier3Alert.ts";
import { loadStaffingCatchup } from "../_shared/settings.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyOfferFailure, type OfferFailure } from "../_shared/managerSummary.ts";
import { daysBetweenDays, prettyDate, venueDay } from "../_shared/datetime.ts";

const SOURCE = "staffing-catchup";
const LABEL = "Staffing Catch-Up";
const HOUR = 3600000;

const NEXT_TIER: Record<string, Tier> = { tier_1: "tier_2", tier_2: "tier_3" };
const TIER_WORD: Record<string, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

const SHIFT_COLS =
  "id, shift_date, shift_type, start_time, status, current_tier, staffing_track, confirmed_at, created_at";

interface ShiftRow {
  id: string;
  shift_date: string;
  shift_type: string;
  start_time: string;
  status: string;
  current_tier: string | null;
  staffing_track: string | null;
  confirmed_at: string | null;
  created_at: string;
}

interface AssignmentRow {
  status: string;
  tier_at_offer: string | null;
  offered_at: string | null;
  reminder_sent_at: string | null;
  cleaners?: { is_active?: boolean } | null;
}

// What this shift is owed today, if anything.
type Plan =
  | { kind: "offer"; tier: Tier; track?: "catchup"; reason: string }
  | { kind: "remind"; tier: Tier }
  | { kind: "escalate"; tier: Tier; from: string; since: Date }
  | { kind: "skip" };

const SKIP: Plan = { kind: "skip" };

// Where a catchup-track shift is up to, read off its assignment rows.
interface ChainState {
  lastOfferedAt: Date | null;   // most recent offer to anyone, any tier
  lastRemindedAt: Date | null;  // most recent reminder for this shift
  chaseableAtTier: number;      // open offers at the CURRENT tier still to chase
}

function maxDate(rows: (string | null)[]): Date | null {
  let best: number | null = null;
  for (const r of rows) {
    if (!r) continue;
    const t = Date.parse(r);
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best);
}

async function chainState(
  sb: ReturnType<typeof serviceClient>,
  shiftId: string,
  tier: string | null,
): Promise<ChainState> {
  const { data } = await sb
    .from("shift_assignments")
    .select("status, tier_at_offer, offered_at, reminder_sent_at, cleaners!inner(is_active)")
    .eq("shift_id", shiftId);
  const rows = (data ?? []) as unknown as AssignmentRow[];
  return {
    lastOfferedAt: maxDate(rows.map((r) => r.offered_at)),
    lastRemindedAt: maxDate(rows.map((r) => r.reminder_sent_at)),
    // Who is genuinely still owed a nudge at this tier. An unconfirmed decline
    // still counts as open — tapping Decline only triggers "are you sure?", and
    // until the cleaner taps Yes they have not responded.
    //
    // Inactive cleaners do NOT count: they are never messaged and never stamped,
    // so counting them would leave the shift waiting on a reminder that can never
    // be sent, sitting at this tier forever instead of escalating.
    chaseableAtTier: rows.filter((r) =>
      r.status === "offered" && r.tier_at_offer === tier &&
      !r.reminder_sent_at && r.cleaners?.is_active === true
    ).length,
  };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const { escalationWaitDays, offerGraceHours } = await loadStaffingCatchup(sb);
  const now = Date.now();
  // Today in venue-local terms — the only unit the day gates compare.
  const today = venueDay(new Date(now));

  // Ordered by date because the acting phase sends in sequence: without it
  // Postgres returns rows in physical storage order — roughly insertion order,
  // and not even that once rows are updated — so a batch arrived as 16 Sept,
  // 21 Sept, 7 Sept. Soonest shift first is chronological and the right priority.

  // (a) Candidates for adoption: confirmed, never offered, not on either chain.
  const { data: unclaimed } = await sb
    .from("shifts").select(SHIFT_COLS)
    .eq("status", "confirmed")
    .is("staffing_track", null)
    .order("shift_date").order("start_time");

  // (b) Shifts already on this chain. fully_staffed and cancelled drop out.
  const { data: mine } = await sb
    .from("shifts").select(SHIFT_COLS)
    .eq("staffing_track", "catchup")
    .in("status", ["confirmed", "staffing"])
    .order("shift_date").order("start_time");

  const shifts = [...(unclaimed ?? []), ...(mine ?? [])] as unknown as ShiftRow[];

  // ---- Phase 1: decide what each shift is owed -----------------------------
  async function decide(s: ShiftRow): Promise<Plan> {
    // Adoption: this shift missed the weekly Tier 1 slot.
    if (!s.staffing_track) {
      const confirmedAt = s.confirmed_at ?? s.created_at;
      const at = Date.parse(confirmedAt);
      // Grace period after confirmation before the first offer. Defaults to 0.
      if (offerGraceHours > 0 && at && now - at < offerGraceHours * HOUR) return SKIP;
      // Wait a full venue-local day before adopting. A shift confirmed today may
      // still be picked up by this week's offer-tier-1 slot, and whichever job
      // offers it first owns it — this gate makes sure that is the weekly job
      // whenever the weekly job is still going to get there.
      if (daysBetweenDays(venueDay(new Date(at || now)), today) < escalationWaitDays) return SKIP;
      return {
        kind: "offer",
        tier: "tier_1",
        track: "catchup",
        reason: `confirmed on ${prettyDate(venueDay(new Date(at || now)))}, after the weekly Tier 1 slot had run`,
      };
    }

    const tier = s.current_tier;
    const st = await chainState(sb, s.id, tier);

    // Staffing status but nothing offered — re-offer at the current tier rather
    // than leaving it stuck.
    if (!st.lastOfferedAt) {
      const t = (tier ?? "tier_1") as Tier;
      return { kind: "offer", tier: t, track: "catchup", reason: `on the catch-up chain at ${TIER_WORD[t]} with no offer on record` };
    }
    // No tier but offers on record: a cleaner cancelled after the shift was full,
    // and cancelOffer already re-offered the freed spot to every available
    // cleaner across all tiers. There is no tier left to step to.
    if (!tier) return SKIP;

    // Anyone at this tier still owed a nudge? The reminder is always the next
    // step after an offer, matching the weekly chain's offer -> remind -> escalate.
    if (st.chaseableAtTier > 0) {
      return daysBetweenDays(venueDay(st.lastOfferedAt), today) < escalationWaitDays
        ? SKIP  // offered today, or still inside a longer wait
        : { kind: "remind", tier: tier as Tier };
    }

    // Everyone at this tier has been reminded (or has already replied) — the next
    // step is opening the shift to the tier below.
    const next = NEXT_TIER[tier];
    if (!next) return SKIP;  // Tier 3, fully chased. Nothing left to automate.
    // Whichever came last — the reminder if one went out, otherwise the offer.
    // That is the last thing these cleaners heard from us, so that is what they
    // have had a full day to answer. A reminder at an EARLIER tier must not be
    // what the gate reads, which is why this is a max and not just lastRemindedAt.
    const since = st.lastRemindedAt && st.lastRemindedAt > st.lastOfferedAt
      ? st.lastRemindedAt
      : st.lastOfferedAt;
    return daysBetweenDays(venueDay(since), today) < escalationWaitDays
      ? SKIP
      : { kind: "escalate", tier: next, from: tier, since };
  }

  const plans: { s: ShiftRow; p: Plan }[] = [];
  for (const s of shifts) {
    try {
      plans.push({ s, p: await decide(s) });
    } catch (e) {
      plans.push({ s, p: SKIP });
      await writeAuditLog(sb, {
        event_type: "staffing.caught_up",
        event_label: LABEL,
        status: "failed",
        summary: `Catch-up could not work out the next step for the shift on ${prettyDate(s.shift_date)}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  let adopted = 0;
  let reminders = 0;
  let escalations = 0;
  let skipped = plans.filter((x) => x.p.kind === "skip").length;
  const failures: OfferFailure[] = [];
  const actions: string[] = [];

  // ---- Phase 2a: reminders, batched per tier -------------------------------
  // All of a tier's due shifts go in one call so sendReminders can collapse a
  // cleaner's several reminders into a single WhatsApp.
  const remindByTier = new Map<Tier, ShiftRow[]>();
  for (const { s, p } of plans) {
    if (p.kind !== "remind") continue;
    const list = remindByTier.get(p.tier);
    if (list) list.push(s);
    else remindByTier.set(p.tier, [s]);
  }
  for (const [tier, due] of remindByTier) {
    try {
      const r = await remindShiftsAtTier(sb, due.map((s) => s.id), tier, SOURCE, `${LABEL} Reminders`);
      if (r.reminded === 0) continue;
      reminders += r.reminded;
      actions.push(`remind ${TIER_WORD[tier]} — ${r.reminded} offer(s) in ${r.names.length} message(s)`);
      await writeAuditLog(sb, {
        event_type: "staffing.caught_up",
        event_label: LABEL,
        status: "success",
        summary: `Catch-up: ${r.reminded} unanswered ${TIER_WORD[tier]} offer(s) chased across ${due.length} shift(s), in ${r.names.length} message(s) to: ${r.names.join(", ")}.`,
        detail: { tier, step: "remind", reminded: r.reminded, cleaners: r.names, shift_ids: due.map((s) => s.id) },
        source: SOURCE,
        triggered_by: "cron",
      });
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "staffing.caught_up",
        event_label: LABEL,
        status: "failed",
        summary: `Catch-up ${TIER_WORD[tier]} reminders failed. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        triggered_by: "cron",
      });
    }
  }

  // ---- Phase 2b: first offers and escalations ------------------------------
  for (const { s, p } of plans) {
    if (p.kind !== "offer" && p.kind !== "escalate") continue;
    const reason = p.kind === "offer"
      ? p.reason
      : `no response at ${TIER_WORD[p.from]} since ${prettyDate(venueDay(p.since))}`;
    try {
      const res = await offerTier(sb, s.id, p.tier, p.kind === "offer" ? p.track : undefined);
      if (p.kind === "offer") adopted += res.count;
      else escalations += res.count;

      if (res.count > 0) {
        const names = res.offered.map((c) => c.full_name).join(", ");
        actions.push(`${prettyDate(s.shift_date)} → ${TIER_WORD[p.tier]} (${res.count})`);
        await writeAuditLog(sb, {
          event_type: "staffing.caught_up",
          event_label: LABEL,
          status: "success",
          summary: `Catch-up: shift on ${prettyDate(s.shift_date)} offered to ${TIER_WORD[p.tier]} — ${reason}. ${res.count} cleaner(s) offered: ${names}.`,
          detail: { shift_id: s.id, tier: p.tier, reason, step: p.kind, count: res.count, cleaners: res.offered },
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
          event_label: LABEL,
          status: "failed",
          summary: `Catch-up offers for shift on ${prettyDate(s.shift_date)} could NOT be sent to ${res.failedNames.join(", ")} — the WhatsApp channel needs reconnecting. No offer delivered.`,
          error_message: "whatsapp send failed",
          detail: { shift_id: s.id, tier: p.tier, failed: res.failed, cleaners: res.failedNames },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
      if (res.count === 0 && res.failed === 0) skipped++;

      // Reaching Tier 3 always needs a human, whether or not a Tier 3 cleaner was
      // free to offer. The helper dedupes, so the daily run can't re-alert.
      if (p.tier === "tier_3") await raiseTier3Alert(sb, s);
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "staffing.caught_up",
        event_label: LABEL,
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

  const moved = adopted + reminders + escalations;
  if (moved === 0 && failures.length === 0) {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_skipped",
      event_label: LABEL,
      status: "skipped",
      summary: `Nothing to catch up. ${skipped} shift(s) checked and all are on track. Shifts on the weekly schedule are handled by their own jobs and are not checked here.`,
      detail: { checked: shifts.length, skipped, escalation_wait_days: escalationWaitDays },
      source: SOURCE,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_run",
      event_label: LABEL,
      status: "success",
      summary: `Catch-up advanced ${moved} step(s) for shifts confirmed after the weekly slot: ${adopted} first offer(s), ${reminders} reminder(s), ${escalations} escalation(s). ${actions.join("; ")}.`,
      detail: { adopted, reminders, escalations, skipped, escalation_wait_days: escalationWaitDays, actions },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, adopted, reminders, escalations, skipped });
});

// staffing-catchup — cron (daily). Adopts shifts confirmed too late to catch the
// weekly Tier 1 slot and sends their FIRST Tier 1 offer. That is now its ONLY
// job. Reminders and escalations — for BOTH tracks — belong to the
// admin-scheduled per-tier jobs (remind-tier-1/2/3, escalate-tier-2/3).
//
// Two chains (shifts.staffing_track — see
// supabase/migrations/20260819120000_staffing_track.sql):
//
//   'weekly'  — offered by offer-tier-1 on its Monday slot.
//   'catchup' — adopted HERE, because the shift was confirmed after the weekly
//               slot had already run and waiting for the next one would burn up
//               to 7 days on a shift that may be days away.
//
// After the first offer BOTH tracks are carried by the same per-tier jobs, each
// firing at the admin's configured Schedule-tab time:
//   remind-tier-1 (e.g. 09:00) -> escalate-tier-2 -> remind-tier-2 -> ...
// So a catch-up shift's reminder lands at the SAME admin-set time as a weekly
// shift's, instead of on this daily slot. This is what fixed the complaint that
// a catch-up shift's 9am reminder went out at the 4pm catch-up time instead.
//
// Why this is safe (it is what caused the 17 August duplicate-reminder flood if
// done wrong): the reminder jobs remind an offer at most once (reminder_sent_at)
// and only while the shift is still at that tier (shifts.current_tier), so a
// superseded offer can never be re-chased — on EITHER track. And because
// catch-up no longer reminds or escalates at all, there is exactly ONE actor per
// step; the two chains cannot both drive one offer.
//
// Adoption timing counts VENUE-LOCAL CALENDAR DAYS since confirmation, not
// elapsed hours: this job runs on one fixed daily slot, and an hours-based gate
// stamped a fraction of a second after the run captured its clock always lands
// microscopically short of 24h and slips a day. The wait (in days) and the
// post-confirmation grace are editable from /schedule (app_settings).
//
// Idempotent: adoption is gated on the confirmation timestamp and offerTier
// stamps staffing_track on the first delivered offer, so a shift is adopted once.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { allCurrentTierOffersReminded, daysSinceCurrentTierOffer, offerTier, type Tier } from "../_shared/engine.ts";
import { raiseTier3Alert } from "../_shared/tier3Alert.ts";
import { loadStaffingCatchup } from "../_shared/settings.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyOfferFailure, type OfferFailure } from "../_shared/managerSummary.ts";
import { prettyDate, venueDay } from "../_shared/datetime.ts";

const SOURCE = "staffing-catchup";
const LABEL = "Staffing Catch-Up";
const HOUR = 3600000;

// Display names only, for the offer audit summaries.
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

// What this shift is owed today, if anything. Catch-up now only ever makes a
// first offer (adoption) or a safety re-offer — reminders and escalations moved
// to the admin-scheduled per-tier jobs.
type Plan =
  | { kind: "offer"; tier: Tier; track?: "catchup"; reason: string }
  | { kind: "skip" };

const SKIP: Plan = { kind: "skip" };

// Does this shift have ANY offer on record (any status, any tier)? A catchup
// shift already adopted but with no offer at all is stuck — every offer was
// rolled back on a send failure — and the per-tier jobs can't rescue it because
// they only act where an offer exists, so catch-up re-offers it. Everything
// else with an offer on record is left to those per-tier jobs.
async function hasAnyOffer(
  sb: ReturnType<typeof serviceClient>,
  shiftId: string,
): Promise<boolean> {
  // Test the STATUS, not offered_at. offered_at is `timestamptz not null default
  // now()` and was never made nullable, so `.not("offered_at","is",null)` matched
  // every row unconditionally — and since roster_manager_on_shift() adds a
  // team_lead row at shift creation, this returned true for every non-wipeover
  // shift before a single offer had been sent. That made the rescue branch below
  // unreachable: a catch-up shift whose every send failed was skipped forever.
  //
  // A real offer is one that reached (or was meant to reach) a cleaner.
  // send_failed is deliberately NOT here — that is precisely the stranded case
  // this check exists to rescue. team_lead is a roster reservation, not an offer.
  const { count } = await sb
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .in("status", ["offered", "accepted", "declined", "cancelled", "no_response"]);
  return (count ?? 0) > 0;
}

// Today's day-of-week in venue-local terms, 0=Sun..6=Sat — the same numbering
// cron uses for its weekday field (where 7 also means Sunday).
function venueWeekday(d: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Australia/Sydney", weekday: "short" }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name] ?? d.getUTCDay();
}

// Does the weekly Tier 1 job (offer-tier-1) run on TODAY's weekday? Read from its
// own cron schedule so an admin re-timing it (including the weekday) is respected.
// Only the weekday field matters here — the time within the day is handled by the
// "already ran today?" audit check at the call site. A schedule we can't read or
// parse falls back to TRUE (assume it runs today), the safe default: catch-up then
// keeps deferring new shifts rather than risk racing the weekly job onto the wrong
// chain. The old hardcoded wait already erred that way, so this is no worse.
async function weeklyOfferRunsToday(sb: ReturnType<typeof serviceClient>): Promise<boolean> {
  try {
    const { data } = await sb.rpc("admin_list_cron_jobs");
    const rows = (data ?? []) as { fn?: string; schedule?: string }[];
    const weekly = rows.find((r) => r.fn === "offer-tier-1");
    if (!weekly?.schedule) return true;
    // cron: "m h dom mon dow". We need the dow (5th) field.
    const dow = weekly.schedule.trim().split(/\s+/)[4];
    if (!dow || dow === "*") return true; // runs every day → always "coming today"
    const todayDow = venueWeekday(new Date());
    // Support comma lists and simple ranges in the dow field; treat 7 as Sunday(0).
    const matches = dow.split(",").some((part) => {
      const norm = (n: number) => (n === 7 ? 0 : n);
      const range = part.split("-").map((x) => norm(Number(x)));
      if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
        const [a, b] = range;
        return a <= b ? todayDow >= a && todayDow <= b : todayDow >= a || todayDow <= b;
      }
      return Number.isFinite(range[0]) && todayDow === range[0];
    });
    return matches;
  } catch {
    return true;
  }
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

  // A past shift can't be staffed, so it must never be adopted, offered or alerted
  // — otherwise a stale understaffed shift keeps firing offers and the URGENT
  // Tier 3 email every day (the 4 Oct shift that emailed on the 6th). Gate both
  // queries on shift_date >= today (venue-local).
  //
  // (a) Candidates for adoption: confirmed, never offered, not on either chain.
  const { data: unclaimed } = await sb
    .from("shifts").select(SHIFT_COLS)
    .eq("status", "confirmed")
    .is("staffing_track", null)
    .gte("shift_date", today)
    .order("shift_date").order("start_time");

  // (b) Shifts already on this chain. fully_staffed and cancelled drop out.
  const { data: mine } = await sb
    .from("shifts").select(SHIFT_COLS)
    .eq("staffing_track", "catchup")
    .in("status", ["confirmed", "staffing"])
    .gte("shift_date", today)
    .order("shift_date").order("start_time");

  const shifts = [...(unclaimed ?? []), ...(mine ?? [])] as unknown as ShiftRow[];

  // Is the weekly Tier 1 job (offer-tier-1) STILL GOING TO RUN LATER TODAY? If so,
  // catch-up must not adopt a freshly-confirmed shift yet — the weekly job should
  // own it, and catch-up racing ahead would put it on the wrong chain. If the
  // weekly job is NOT coming today (it is not its scheduled weekday, or it already
  // ran), then catch-up is the only thing that will offer this shift, so it adopts
  // immediately — no "wait a day". That blanket one-day wait was the bug: a shift
  // confirmed mid-morning on a NON-weekly day still got no offer on that afternoon's
  // catch-up run, it was held to the next day.
  //
  // "Still coming today" = today is the weekly job's scheduled weekday AND it has
  // not run yet today. The weekday comes from the job's own cron schedule (so an
  // admin re-timing it is respected); whether it ran comes from its audit trail,
  // which it writes on EVERY run.
  const { data: lastWeekly } = await sb
    .from("audit_logs")
    .select("created_at")
    .eq("source", "offer-tier-1")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastWeeklyRunAt = (lastWeekly as { created_at?: string } | null)?.created_at ?? null;
  const weeklyRanToday = lastWeeklyRunAt != null && venueDay(new Date(lastWeeklyRunAt)) === today;
  const weeklyRunsToday = await weeklyOfferRunsToday(sb);
  const weeklyStillComingToday = weeklyRunsToday && !weeklyRanToday;

  // ---- Phase 1: decide what each shift is owed -----------------------------
  async function decide(s: ShiftRow): Promise<Plan> {
    // Adoption: this shift missed the weekly Tier 1 slot.
    if (!s.staffing_track) {
      const confirmedAt = s.confirmed_at ?? s.created_at;
      const at = Date.parse(confirmedAt);
      // Grace period after confirmation before the first offer. Defaults to 0.
      if (offerGraceHours > 0 && at && now - at < offerGraceHours * HOUR) return SKIP;
      // Only defer while the weekly job is still going to run today — let it take
      // the shift. On any other run, catch-up is the shift's only route to an
      // offer, so adopt it now rather than holding it to tomorrow.
      if (weeklyStillComingToday) return SKIP;
      return {
        kind: "offer",
        tier: "tier_1",
        track: "catchup",
        reason: weeklyRanToday
          ? `confirmed after today's weekly Tier 1 run had already gone out`
          : `confirmed on a day the weekly Tier 1 slot does not run`,
      };
    }

    // Already adopted. This job's ONLY remaining responsibility is the first
    // offer; the reminder and every escalation are handled by the admin-scheduled
    // per-tier jobs (remind-tier-1/2/3, escalate-tier-2/3), which now act on the
    // catchup track too. That is what makes a catch-up shift's reminder land at
    // the admin's configured time (e.g. 9am) rather than on this daily slot.
    //
    // The one exception is a safety re-offer: a shift left in `staffing` with no
    // offer on record at all (e.g. every offer was rolled back on a send
    // failure) would otherwise sit forever, because the per-tier jobs only act
    // where an offer already exists. Re-offer it at its current tier.
    const tier = s.current_tier;
    if (!(await hasAnyOffer(sb, s.id))) {
      const t = (tier ?? "tier_1") as Tier;
      return { kind: "offer", tier: t, track: "catchup", reason: `on the catch-up chain at ${TIER_WORD[t]} with no offer on record` };
    }
    // Offers are on record — nothing for this job to do. The per-tier reminder
    // and escalation jobs carry it from here.
    return SKIP;
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
  let skipped = plans.filter((x) => x.p.kind === "skip").length;
  const failures: OfferFailure[] = [];
  const actions: string[] = [];

  // ---- Phase 2: first offers (adoption) and safety re-offers ---------------
  // Catch-up only ever offers here. Reminders and escalations are the
  // admin-scheduled per-tier jobs' responsibility (they act on this track too).
  for (const { s, p } of plans) {
    if (p.kind !== "offer") continue;
    const reason = p.reason;
    try {
      const res = await offerTier(sb, s.id, p.tier, p.track);
      adopted += res.count;

      if (res.count > 0) {
        const names = res.offered.map((c) => c.full_name).join(", ");
        actions.push(`${prettyDate(s.shift_date)} → ${TIER_WORD[p.tier]} (${res.count})`);
        await writeAuditLog(sb, {
          event_type: "staffing.caught_up",
          event_label: LABEL,
          status: "success",
          summary: `Catch-up: shift on ${prettyDate(s.shift_date)} offered to ${TIER_WORD[p.tier]} — ${reason}. ${res.count} cleaner(s) offered: ${names}.`,
          detail: { shift_id: s.id, tier: p.tier, reason, step: "offer", count: res.count, cleaners: res.offered },
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

      // Reaching Tier 3 always needs a human — but, like escalate-tier-3, only
      // AFTER the Tier 3 cleaners have been reminded (or the offer is well
      // overdue), so the alert never pre-empts the reminder. This path is only
      // reachable via the safety re-offer of a shift already sitting at tier_3;
      // raiseTier3Alert dedupes, so the daily run can't re-alert.
      if (p.tier === "tier_3") {
        const reminded = await allCurrentTierOffersReminded(sb, s.id, "tier_3");
        const overdue = await daysSinceCurrentTierOffer(sb, s.id, "tier_3") >= 2;
        if (reminded || overdue) await raiseTier3Alert(sb, s);
      }
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

  const moved = adopted;
  if (moved === 0 && failures.length === 0) {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_skipped",
      event_label: LABEL,
      status: "skipped",
      summary: `Nothing to catch up. ${skipped} shift(s) checked and all are on track. Reminders and escalations for these shifts are handled by the scheduled per-tier jobs; weekly-schedule shifts are handled by their own jobs and are not checked here.`,
      detail: { checked: shifts.length, skipped, escalation_wait_days: escalationWaitDays },
      source: SOURCE,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "staffing.catchup_run",
      event_label: LABEL,
      status: "success",
      summary: `Catch-up sent the first Tier 1 offer for ${adopted} shift(s) confirmed after the weekly slot. Their reminders and escalations follow at the scheduled per-tier times. ${actions.join("; ")}.`,
      detail: { adopted, skipped, escalation_wait_days: escalationWaitDays, actions },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, adopted, skipped });
});

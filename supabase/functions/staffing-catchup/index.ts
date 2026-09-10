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
import { offerTier, type Tier } from "../_shared/engine.ts";
import { raiseTier3Alert } from "../_shared/tier3Alert.ts";
import { loadStaffingCatchup } from "../_shared/settings.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyOfferFailure, type OfferFailure } from "../_shared/managerSummary.ts";
import { daysBetweenDays, prettyDate, venueDay } from "../_shared/datetime.ts";

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
  const { count } = await sb
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .not("offered_at", "is", null);
  return (count ?? 0) > 0;
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

      // Reaching Tier 3 always needs a human, whether or not a Tier 3 cleaner was
      // free to offer. The helper dedupes, so the daily run can't re-alert. Only
      // reachable via the safety re-offer of a shift already sitting at tier_3.
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

-- ============================================================================
-- shifts.staffing_track — separate the weekly chain from the catch-up chain
-- ============================================================================
-- Until now every automation job looked at every shift. The weekly chain
-- (offer-tier-1 Mon -> remind-tier-1 Tue am -> escalate-tier-2 Tue pm -> ...)
-- and the daily staffing-catchup job therefore both drove the SAME shifts, on
-- two different clocks.
--
-- What that produced, live: a shift confirmed mid-week never reached the weekly
-- chain, so staffing-catchup offered Tier 1, then escalated it to Tier 2 and
-- Tier 3 on its own 24h clock. Nothing closed the Tier-1 offer it escalated
-- past, so that row sat `offered` with reminder_sent_at still null. The weekly
-- remind-tier-1 job only fires once a week — so several weeks' worth of those
-- orphaned rows accumulated silently and all fired in a single burst on the
-- next Tuesday morning. That is the flood of duplicate reminders the client saw
-- on 17 August, covering shift dates from 7 to 27 September.
--
-- A shift now belongs to exactly ONE track, decided at its first offer and never
-- changed:
--   'weekly'  — offered by offer-tier-1 on its weekly slot. Only the weekly cron
--               jobs (offer/remind/escalate) ever touch it. staffing-catchup
--               ignores it entirely.
--   'catchup' — confirmed too late for the weekly slot, so staffing-catchup
--               adopted it. staffing-catchup then owns the WHOLE chain for that
--               shift (offer, remind, escalate, remind, escalate, remind), one
--               step per run, each gated on escalation_wait_days. The weekly
--               jobs ignore it entirely.
--
-- Null = not yet offered, so not yet on either track.
-- ============================================================================

alter table public.shifts
  add column if not exists staffing_track text
    check (staffing_track in ('weekly', 'catchup'));

comment on column public.shifts.staffing_track is
  'Which automation chain owns this shift: weekly (the /schedule cron chain) or catchup (staffing-catchup''s own 24h chain). Set once, at the first offer that is actually delivered. Null until then.';

-- Every job filters on this, always alongside status/current_tier.
create index if not exists idx_shifts_staffing_track
  on public.shifts (staffing_track, status, current_tier);

-- ---------------------------------------------------------------------------
-- Backfill: which chain has each already-offered shift actually been running on?
-- ---------------------------------------------------------------------------
-- Read it from the audit trail. Every first offer writes one row, and the
-- `source` names the job that sent it. Earliest such row wins — that is the
-- offer that put the shift on its track.
with first_offer as (
  select distinct on (a.shift_id)
    a.shift_id,
    a.source
  from public.audit_logs a
  where a.shift_id is not null
    and a.source in ('offer-tier-1', 'staffing-catchup')
    and a.status = 'success'
  order by a.shift_id, a.created_at
)
update public.shifts s
set staffing_track = case when f.source = 'staffing-catchup' then 'catchup' else 'weekly' end
from first_offer f
where f.shift_id = s.id
  and s.staffing_track is null;

-- Anything already being staffed but with no audit row to judge by (manual
-- admin offers, or rows predating the audit log) goes to 'weekly'. That is the
-- safe default: it keeps the shift on the jobs that have been driving it, and
-- keeps staffing-catchup off it.
update public.shifts s
set staffing_track = 'weekly'
where s.staffing_track is null
  and s.status in ('staffing', 'fully_staffed')
  and exists (
    select 1 from public.shift_assignments sa
    where sa.shift_id = s.id
      and sa.status <> 'team_lead'
  );

-- ---------------------------------------------------------------------------
-- One-time cleanup: close the orphaned offers that caused the burst
-- ---------------------------------------------------------------------------
-- Any offer still sitting `offered` at a tier the shift has ALREADY escalated
-- past. The cleaner did not respond and the shift has moved on, so the offer is
-- dead — but it is still queued for a reminder that would go out weeks late.
-- Closing them here stops the next weekly run from firing the same burst again.
-- (engine.ts now does this at the moment of escalation, so it cannot rebuild.)
--
-- Verified before writing this migration: all 19 matching rows had already been
-- reminded — they ARE the 17/18 August burst, still sitting open. None is a
-- fresh cancellation re-offer.
--
-- Strictly EARLIER tiers only. A cancellation re-offer (offerAllRemaining)
-- deliberately opens later tiers while the shift sits at an earlier one; those
-- are live offers and must not be touched. `<` on cleaner_tier compares by the
-- enum's declared order, which is tier_1, tier_2, tier_3 — so this reads exactly
-- as "offered at a tier below where the shift has got to".
update public.shift_assignments sa
set status = 'no_response'
from public.shifts s
where s.id = sa.shift_id
  and sa.status = 'offered'
  and sa.tier_at_offer is not null
  and s.current_tier is not null
  and sa.tier_at_offer < s.current_tier;

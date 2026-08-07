-- ============================================================================
-- Non-responder reminders, split per tier
-- ============================================================================
-- One "Non-Responder Reminders" job chased every open offer on a single
-- schedule, so a Tier 3 offer made minutes earlier could be reminded on the
-- same run as a Tier 1 offer made a day before.
--
-- It is replaced by three independently-schedulable jobs — one per tier — so an
-- admin can chase each tier on its own cadence from the Automation Schedule
-- page. Each reminds only offers made AT ITS OWN TIER (tier_at_offer), still at
-- most once per offer (reminder_sent_at).
--
-- Times below place each tier's reminder after that tier's own offer step:
--   Tier 1 offers (Mon 15:00) -> Tier 1 reminder (Tue 09:00)
--   Tier 2 opens  (Tue 15:00) -> Tier 2 reminder (Wed 09:00)
--   Tier 3 opens  (Wed 15:00) -> Tier 3 reminder (Thu 09:00)
-- Stated in UTC, matching the other seeded jobs; admins adjust from /schedule.
-- ============================================================================

-- Retire the combined job. The Edge Function stays deployed as a no-op stub so
-- a stray invocation can't double up on the new per-tier passes. Guarded so the
-- migration is safe to re-run and won't fail if the job was already removed.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'wy-remind-nonresponders') then
    perform cron.unschedule('wy-remind-nonresponders');
  end if;
end $$;

-- Tier 1 — the morning after Tier 1 offers go out.
select cron.schedule('wy-remind-tier-1', '0 23 * * 1', $$ select public.invoke_edge('remind-tier-1') $$);  -- Mon 23:00 UTC = Tue 09:00 AEST

-- Tier 2 — the morning after the shift opens to Tier 2.
select cron.schedule('wy-remind-tier-2', '0 23 * * 2', $$ select public.invoke_edge('remind-tier-2') $$);  -- Tue 23:00 UTC = Wed 09:00 AEST

-- Tier 3 — the morning after the shift opens to Tier 3.
select cron.schedule('wy-remind-tier-3', '0 23 * * 3', $$ select public.invoke_edge('remind-tier-3') $$);  -- Wed 23:00 UTC = Thu 09:00 AEST

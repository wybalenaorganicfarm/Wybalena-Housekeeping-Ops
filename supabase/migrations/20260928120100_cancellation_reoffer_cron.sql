-- ============================================================================
-- Register cancellation-reoffer on pg_cron.
--
-- Runs DAILY at the 3pm venue-time offer slot — the same time the weekly Tier 1
-- offers go out — so a cancellation with plenty of notice is re-offered alongside
-- the day's other offers rather than pinging cleaners at a random hour. Unlike the
-- Tuesday-only tier jobs this is daily, because a cancellation can land any day.
--
-- SEED TIME: the seed cron migration (20260625100100_cron.sql) scheduled
-- wy-offer-tier-1 at 09:30 UTC as a testing (IST) slot; the live jobs were since
-- re-timed to the venue's 3pm from the Automation Schedule page. This job is
-- seeded on the SAME 09:30 UTC daily slot as the original offer-tier-1 so it lands
-- in the same family, and — like every other job — it is re-timable from the
-- Schedule page (it surfaces there by jobname). We deliberately do NOT hardcode a
-- venue-3pm UTC value here, to avoid re-introducing the DST drift the runtime
-- rescheduling exists to manage.
--
-- Idempotent: unschedule-then-schedule, matching the seed migration's pattern, so
-- re-running this migration never errors on an existing job.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wy-cancellation-reoffer') then
    perform cron.unschedule('wy-cancellation-reoffer');
  end if;
end;
$$;

select cron.schedule(
  'wy-cancellation-reoffer',
  '30 9 * * *',
  $$ select public.invoke_edge('cancellation-reoffer') $$
);

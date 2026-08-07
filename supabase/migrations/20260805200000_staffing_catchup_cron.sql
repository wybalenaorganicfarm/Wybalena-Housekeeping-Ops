-- ============================================================================
-- Daily staffing catch-up job
-- ============================================================================
-- Runs every day and advances any shift the weekly chain has left behind — see
-- supabase/functions/staffing-catchup/index.ts for the rules. Scheduled an hour
-- after the Tier 1 offer slot so it never races the weekly job on the same
-- shift; on other days it is the only thing moving offers along.
--
-- Admins can reschedule or pause it from the Automation Schedule page like any
-- other job.
-- ============================================================================

select cron.schedule(
  'wy-staffing-catchup',
  '0 6 * * *',                                              -- 06:00 UTC = 16:00 AEST daily
  $$ select public.invoke_edge('staffing-catchup') $$
);

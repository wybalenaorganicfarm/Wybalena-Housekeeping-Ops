-- ============================================================================
-- Schedule the wipeover-cleaning notifier (venue-gap detection + email to Ashley).
-- Extracted from sync-bookings so it can be scheduled independently on the
-- /schedule page. Default: weekly, just after the booking sync. The admin can
-- change/pause this from the Automation Schedule page (admin_set_cron_schedule).
--
-- UTC cron (TESTING IST convention, mirrors 20260625100100_cron.sql):
--   '15 8 * * 2' = 08:15 UTC Tue = 13:45 IST Tue.
-- Idempotent: cron.schedule upserts on the job name.
-- ============================================================================
select cron.schedule(
  'wy-wipeover-notify',
  '15 8 * * 2',
  $$ select public.invoke_edge('wipeover-notify') $$
);

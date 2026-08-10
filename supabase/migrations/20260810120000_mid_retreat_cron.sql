-- ============================================================================
-- Schedule the mid-retreat-clean notifier (long-stay detection + email/WhatsApp
-- to the Operations Manager).
-- ============================================================================
-- 20260805150000_mid_retreat_alert.sql turned mid-retreat cleans into a notice
-- instead of an auto-created shift, but left the detection inside sync-bookings.
-- That made it invisible on the Automation Schedule page and tied it to the
-- sync's own constraints: only bookings checking out in the target week, and
-- only those with no shift yet, were ever considered.
--
-- It now runs as its own job (see supabase/functions/mid-retreat-notify), which
-- scans every upcoming booking on each run — exactly how wipeover-notify was
-- extracted in 20260701130000_wipeover_cron.sql.
--
-- Default: weekly, just after the booking sync and the wipeover notice, so all
-- three post-sync notices land together. The admin can change or pause this from
-- the Automation Schedule page (admin_set_cron_schedule).
--
-- UTC cron (TESTING IST convention, mirrors 20260625100100_cron.sql):
--   '20 8 * * 2' = 08:20 UTC Tue = 13:50 IST Tue.
-- Idempotent: cron.schedule upserts on the job name.
-- ============================================================================
select cron.schedule(
  'wy-mid-retreat-notify',
  '20 8 * * 2',
  $$ select public.invoke_edge('mid-retreat-notify') $$
);

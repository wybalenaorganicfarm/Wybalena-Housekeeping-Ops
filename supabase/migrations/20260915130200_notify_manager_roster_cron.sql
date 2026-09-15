-- ============================================================================
-- Register notify-manager-roster on pg_cron.
--
-- ~15-min cadence: "you've been rostered" is acted on the same day, so a
-- multi-hour lag is a real operational problem, but it is not minute-critical.
-- Every-15-min is timezone-independent, so unlike the fixed-time jobs in
-- 20260625100100_cron.sql it needs NO recalculation at go-live (Australia).
--
-- No ordering dependency (unlike reminder-before-escalation): this job touches
-- ONLY status='team_lead' rows and the lead_notified_at column, which no other
-- job reads or writes — so running concurrently with the tier crons at the top of
-- the hour has no shared-row contention.
--
-- Registered declaratively here (plain cron.schedule, matching how every existing
-- wy-* job was seeded) rather than via admin_set_cron_schedule — that RPC is for
-- runtime rescheduling from the Automation Schedule page. This job still surfaces
-- there by its jobname, so it stays manageable from the UI.
-- ============================================================================

select cron.schedule(
  'wy-notify-manager-roster',
  '*/15 * * * *',
  $$ select public.invoke_edge('notify-manager-roster') $$
);

-- ============================================================================
-- Staffing catch-up: escalation waits become elapsed-time, and configurable
-- ============================================================================
-- The offer/escalation chain is status-driven but fires only on its weekly cron
-- slots. If the Operations Manager misses the Monday confirmation email and
-- confirms late, the shift is not offered until the NEXT week's run — up to 7
-- days lost on a shift that may be days away.
--
-- A new daily `staffing-catchup` job closes that gap: it advances any shift that
-- has fallen behind, using each shift's OWN clock rather than the weekly slots.
--   • confirmed but never offered      -> Tier 1 offers now
--   • Tier 1 offered, wait elapsed     -> escalate to Tier 2
--   • Tier 2 offered, wait elapsed     -> escalate to Tier 3
-- The elapsed time comes from shift_assignments.offered_at, so no new column is
-- needed and a late-confirmed shift is never disadvantaged.
--
-- The wait (default 24h, matching the client's ask) is stored here so it can be
-- tuned from the Schedule page — same pattern as booking_sync_range.
-- ============================================================================

insert into public.app_settings (key, value, label, description)
values (
  'staffing_catchup',
  '{"escalation_wait_hours": 24, "offer_grace_hours": 0}'::jsonb,
  'Staffing catch-up timing',
  'How long a shift waits at one tier before the daily catch-up escalates it to the next, and how long a newly-confirmed shift waits before its first offer goes out.'
)
on conflict (key) do nothing;

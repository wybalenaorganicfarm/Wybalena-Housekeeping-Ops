-- ============================================================================
-- Staffing catch-up: tier wait moves from hours to whole days
-- ============================================================================
-- The catch-up runs on one fixed daily slot, so an hours-based gate could never
-- clear it. `offered_at` is stamped a fraction of a second AFTER the run reads
-- its own clock, so the next day's "24h elapsed?" check came up a few hundred
-- milliseconds short every time, skipped, and the escalation landed at 48h. Live
-- evidence: every tier-to-tier gap on the September shifts measured 48.000h, so
-- Tier 2 arrived Thursday instead of Wednesday and Tier 3 Saturday instead of
-- Thursday.
--
-- Counting venue-local calendar days makes Tier 1 Monday -> Tier 2 Tuesday ->
-- Tier 3 Wednesday exact, whatever the run latency. See
-- supabase/functions/staffing-catchup/index.ts.
--
-- 24 hours -> 1 day. The loader also converts any lingering
-- escalation_wait_hours on the fly, so this migration is a tidy-up rather than a
-- prerequisite. offer_grace_hours is unchanged: it spans confirmation -> first
-- offer, where sub-day precision is still meaningful.
--
-- Only this job changes. The weekly offer/escalation chain keeps running purely
-- off its own cron slots on the Automation Schedule page.
-- ============================================================================

update public.app_settings
set value = jsonb_build_object(
      'escalation_wait_days',
      greatest(1, round(coalesce((value ->> 'escalation_wait_hours')::numeric, 24) / 24))::int,
      'offer_grace_hours',
      coalesce((value ->> 'offer_grace_hours')::int, 0)
    )
where key = 'staffing_catchup'
  and value ? 'escalation_wait_hours';

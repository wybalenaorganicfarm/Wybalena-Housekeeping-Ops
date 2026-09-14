-- ============================================================================
-- Run the per-tier reminder AND escalation jobs DAILY
-- ============================================================================
-- Bug this fixes (Karin Gisler, 18 Oct catch-up shift — reminder never sent):
--
-- The Sept "fix" moved catch-up shifts' reminders and escalations OFF the daily
-- staffing-catchup slot and onto the shared per-tier jobs
-- (remind-tier-1/2/3, escalate-tier-2/3), so a catch-up shift would be chased
-- "on the same clock as every other shift". But those per-tier jobs were seeded
-- to run WEEKLY, each on a single fixed weekday:
--
--   wy-remind-tier-1   0 23 * * 1   (Mondays only)
--   wy-remind-tier-2   0 23 * * 2   (Tuesdays only)
--   wy-remind-tier-3   0 23 * * 3   (Wednesdays only)
--   wy-escalate-tier-2 30 10 * * 2  (Tuesdays only)
--   wy-escalate-tier-3 0 11 * * 2   (Tuesdays only)
--
-- That cadence lines up with the WEEKLY track (offer-tier-1 also runs weekly, so
-- its shifts are always at the right tier on the right weekday). It does NOT line
-- up with the CATCH-UP track: staffing-catchup runs DAILY and can adopt + first-
-- offer a shift on ANY day. A shift adopted on, say, a Thursday would wait until
-- the following Monday night for its Tier-1 reminder — and by then the weekly
-- escalation jobs may have moved it past Tier 1, so remind-tier-1's
-- `shifts.current_tier = tier` filter drops the offer and the reminder is never
-- sent. That is exactly what happened to Karin's 18 Oct shift.
--
-- Fix: run the reminder and escalation jobs DAILY, so a catch-up shift is chased
-- the morning after its offer regardless of which weekday it was adopted on. This
-- is safe — the jobs were built to be idempotent per offer:
--   • reminders: `reminder_sent_at` stamps each offer once, and `current_tier =
--     tier` only chases while the shift is still at that tier — so a daily run
--     never double-reminds. (See _shared/remindTier.ts.)
--   • escalations: daysSinceCurrentTierOffer >= 1 holds a shift at its tier for
--     at least one venue-local day since its most recent offer there, so a daily
--     run still spaces tiers a day apart and never escalates a shift the same day
--     it was offered. Weekly-track shifts keep their one-tier-per-day cadence.
--     (See escalate-tier-2/index.ts.)
--
-- Time-of-day is kept at each job's existing slot; only the day-of-week field
-- (* instead of a fixed weekday) changes. Admins can still override any of these
-- from the Automation Schedule page.
-- ============================================================================

-- Reminders — every morning, not just the one weekday.
select cron.schedule('wy-remind-tier-1', '0 23 * * *', $$ select public.invoke_edge('remind-tier-1') $$);  -- 23:00 UTC = 09:00 AEST daily
select cron.schedule('wy-remind-tier-2', '0 23 * * *', $$ select public.invoke_edge('remind-tier-2') $$);  -- 23:00 UTC = 09:00 AEST daily
select cron.schedule('wy-remind-tier-3', '0 23 * * *', $$ select public.invoke_edge('remind-tier-3') $$);  -- 23:00 UTC = 09:00 AEST daily

-- Escalations — every day; the >=1-day per-tier hold in the job keeps the spacing.
select cron.schedule('wy-escalate-tier-2', '30 10 * * *', $$ select public.invoke_edge('escalate-tier-2') $$);  -- 10:30 UTC = 20:30 AEST daily
select cron.schedule('wy-escalate-tier-3', '0 11 * * *',  $$ select public.invoke_edge('escalate-tier-3') $$);  -- 11:00 UTC = 21:00 AEST daily

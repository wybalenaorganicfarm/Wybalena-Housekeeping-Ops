-- ============================================================================
-- Order the daily jobs so each tier's REMINDER fires before its ESCALATION
-- ============================================================================
-- Bug this fixes (follow-up to 20260914120000):
--
-- Making the reminder and escalation jobs daily was right, but their times were
-- left as-is, which put the escalations EARLIER in the UTC day than the reminders:
--
--   wy-escalate-tier-2  30 10 * * *   (10:30 UTC)
--   wy-escalate-tier-3   0 11 * * *   (11:00 UTC)
--   wy-remind-tier-1/2/3 0 23 * * *   (23:00 UTC)
--
-- So every day the escalations ran ~12h BEFORE the reminders. A shift sitting at
-- a tier for >=1 day would be escalated to the next tier at 10:30, and by the time
-- remind-tier-N ran at 23:00 the shift's `current_tier` had already moved on — so
-- remind-tier-N's `current_tier = tier` filter skipped it and the reminder at that
-- tier was never sent. (This is the same class of miss as Karin's 18 Oct shift.)
--
-- Fix: run the REMINDERS first (early in the UTC day) and the ESCALATIONS after,
-- on the same daily cycle. Now, each day, a shift still at tier N is reminded at
-- tier N in the morning slot, and only later that day (if still unanswered and
-- >=1 day at the tier) escalated onward. Times are chosen so both slots land in
-- daytime/early-evening Sydney and the reminder always precedes the escalation.
--
--   Reminders   20:00 UTC  (~06:00-07:00 Sydney next morning, AEST/AEDT)
--   Escalations 22:00 / 22:30 UTC  (~08:00-09:30 Sydney, AFTER the reminder)
--
-- NOTE (DST): these UTC offsets still shift by one hour across Sydney DST — see
-- the standing "recalculate for the venue timezone" caveat in 20260625100100.
-- What this migration guarantees regardless of DST is the RELATIVE ORDER: reminders
-- (20:00) always run before escalations (22:00/22:30) within the same UTC day, so
-- the reminder-then-escalate sequence holds year-round. Admins can still override
-- any job's time from the Automation Schedule page; keep reminders < escalations.
-- ============================================================================

-- Reminders — early in the UTC day, before the escalations.
select cron.schedule('wy-remind-tier-1', '0 20 * * *', $$ select public.invoke_edge('remind-tier-1') $$);
select cron.schedule('wy-remind-tier-2', '0 20 * * *', $$ select public.invoke_edge('remind-tier-2') $$);
select cron.schedule('wy-remind-tier-3', '0 20 * * *', $$ select public.invoke_edge('remind-tier-3') $$);

-- Escalations — later the same UTC day, AFTER the reminders have run.
select cron.schedule('wy-escalate-tier-2', '0 22 * * *',  $$ select public.invoke_edge('escalate-tier-2') $$);
select cron.schedule('wy-escalate-tier-3', '30 22 * * *', $$ select public.invoke_edge('escalate-tier-3') $$);

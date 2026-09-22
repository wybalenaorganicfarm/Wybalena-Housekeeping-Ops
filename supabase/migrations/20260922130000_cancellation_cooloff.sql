-- ============================================================================
-- App setting: cancellation cooling-off
-- ============================================================================
-- How long a cleaner who cancels her own shift is left out of that shift's
-- automatic re-offers (reofferToUnaccepted in _shared/engine.ts).
--
-- Background: 20260921120000_self_cancelled_at.sql added the marker that tells a
-- cleaner's own WhatsApp cancellation apart from an admin removal. That first
-- cut excluded her permanently. Ashleigh asked for a window instead — long
-- enough that she isn't offered back a shift she just dropped, short enough that
-- she can still pick it up if her plans change.
--
-- HOURS here, unlike the catch-up's escalationWaitDays. That setting counts days
-- because its job runs on one fixed daily slot, where an hours-based comparison
-- lands a fraction short of 24h and slips a whole extra day. This check runs on
-- the cancellation EVENT, against a stored timestamp, so hours are exact and a
-- sub-day window (which is the point) is expressible.
--
-- 0 disables the cooling-off entirely — every self-canceller is immediately
-- offerable again, i.e. the pre-fix behaviour. Kept reachable deliberately so
-- the behaviour can be turned off from the app without a redeploy.
-- ============================================================================

insert into public.app_settings (key, value, label, description)
values (
  'cancellation_cooloff',
  '{"cooloff_hours": 48}'::jsonb,
  'Cancellation cooling-off',
  'After a cleaner cancels a shift, how long before that shift can be automatically offered back to her. Admin can still assign her manually at any time. Set to 0 to switch the cooling-off off.'
)
on conflict (key) do nothing;

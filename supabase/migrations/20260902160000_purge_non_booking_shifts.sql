-- Clean up shifts already created from non-booking calendar entries.
-- ============================================================================
-- The calendar sync had no title filter, so operational blocks — "UNAVAILABLE",
-- owner stays, maintenance — were treated as guest bookings and generated
-- cleaning shifts. sync-bookings now skips them, but that only stops NEW ones:
-- the rows already in the database stay, and one of them has been sitting on the
-- schedule as a real shift.
--
-- This cancels those shifts and marks their bookings cancelled. Deliberately NOT
-- a delete: an admin should be able to see what happened and why, and a delete
-- would silently remove a shift someone may have already been offered.
--
-- The title test mirrors isNonBookingEvent() in _shared/adapters/calendar.ts.
-- Keep the two in step if the word list changes.
-- ============================================================================

-- Same rule as the Edge Function: whole-word, case-insensitive, punctuation
-- collapsed to spaces so "UNAVAILABLE-maintenance" still splits into words.
create or replace function public.is_non_booking_title(p_title text)
returns boolean
language sql
immutable
as $$
  select case
    when p_title is null or btrim(p_title) = '' then false
    else ' ' || btrim(regexp_replace(lower(p_title), '[^a-z0-9]+', ' ', 'g')) || ' ' ~
         ' (unavailable|not available|blocked|block out|blockout|owner stay|maintenance|closed|do not book) '
  end;
$$;

comment on function public.is_non_booking_title(text) is
  'True when a calendar event title marks an operational block rather than a guest booking. Mirrors isNonBookingEvent() in _shared/adapters/calendar.ts.';

-- Close any open offers on those shifts first, so the reminder and escalation
-- jobs stop chasing cleaners about a shift that should never have existed.
-- 'no_response' is the engine's term for an offer closed without a reply.
update public.shift_assignments a
   set status = 'no_response'
  from public.shifts s
       join public.bookings b on b.id = s.booking_id
 where a.shift_id = s.id
   and a.status in ('offered', 'accepted')
   and s.status <> 'cancelled'
   and public.is_non_booking_title(b.guest_name);

-- Cancel the shifts themselves.
update public.shifts s
   set status = 'cancelled',
       cancelled_at = coalesce(s.cancelled_at, now())
  from public.bookings b
 where s.booking_id = b.id
   and s.status <> 'cancelled'
   and public.is_non_booking_title(b.guest_name);

-- Mark the underlying "bookings" as cancelled so they are never re-used, and so
-- a future sync of the same calendar entry cannot resurrect a shift from them.
update public.bookings
   set is_cancelled = true
 where is_cancelled = false
   and public.is_non_booking_title(guest_name);

-- Close any alerts that were raised for those shifts.
update public.alerts al
   set status = 'dismissed'
  from public.shifts s
       join public.bookings b on b.id = s.booking_id
 where al.shift_id = s.id
   and al.status = 'open'
   and public.is_non_booking_title(b.guest_name);

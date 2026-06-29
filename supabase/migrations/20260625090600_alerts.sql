-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 8
-- alerts (Ashley's review queue)
-- ============================================================================

create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  alert_type   alert_type not null,
  shift_id     uuid references public.shifts (id) on delete cascade,
  booking_id   uuid references public.bookings (id) on delete cascade,
  status       alert_status not null default 'open',
  title        text not null,
  body         text,
  actioned_by  uuid references public.profiles (id),
  actioned_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.alerts is 'Review queue surfaced to Ashley: venue gaps, unconfirmed shifts, booking cancellations, understaffing, cleaner cancellations.';

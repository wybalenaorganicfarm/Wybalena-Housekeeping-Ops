-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 5
-- bookings (synced from Google Calendar)
-- ============================================================================
-- Unique gcal_event_id is the dedupe key that makes "already in system -> skip"
-- idempotent on every sync run. is_cancelled is set when a GCal event is
-- detected removed; it does NOT auto-cancel shifts (Ashley stays in control).
-- ============================================================================

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  gcal_event_id  text not null unique,                 -- dedupe key
  guest_name     text,
  check_in       timestamptz not null,
  check_out      timestamptz not null,
  nights         integer not null,                     -- drives the >=7-night rule
  guest_count    integer,
  is_cancelled   boolean not null default false,       -- set when GCal event detected removed
  raw_payload    jsonb,                                 -- original event, for debugging
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.bookings is 'Google Calendar bookings. gcal_event_id unique = idempotent sync. is_cancelled never auto-cancels shifts.';

create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

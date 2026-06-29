-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 6
-- shifts (the core object)
-- ============================================================================
-- required_cleaners is stored per shift (6 standard / 7 deep) so manual
-- overrides persist. Status transitions are enforced in backend logic (Edge
-- Functions), NOT by DB constraints, to allow override-at-any-stage:
--   pending_confirmation -> confirmed -> staffing -> fully_staffed
--   cancelled is reachable from any state.
-- ============================================================================

create table public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid references public.bookings (id) on delete set null,  -- null for manual shifts
  shift_type           shift_type not null,
  shift_date           date not null,
  start_time           time not null,
  estimated_hours      numeric not null default 4,
  status               shift_status not null default 'pending_confirmation',
  source               shift_source not null,
  required_cleaners    integer not null,              -- from formula (6 or 7), override-able
  is_modified          boolean not null default false, -- edited after auto-creation
  special_instructions text,
  current_tier         cleaner_tier,                   -- tier currently being offered
  confirmed_at         timestamptz,
  confirmed_by         uuid references public.profiles (id),
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.shifts is 'Core cleaning shift. Status transitions enforced in Edge Functions, not DB constraints (override-at-any-stage).';
comment on column public.shifts.required_cleaners is 'Stored so manual overrides persist. 6 = standard (Zara + 5), 7 = deep/full venue (Zara + 6).';

create trigger trg_shifts_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

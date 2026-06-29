-- ============================================================================
-- Partial-venue support
-- ============================================================================
-- Cleans are full-venue by default. During the once-a-year holiday season we
-- occasionally clean individual buildings only, so a shift can optionally be
-- scoped to a specific list of buildings.
-- ============================================================================

alter table public.shifts
  add column if not exists venue_scope text   not null default 'full_venue',
  add column if not exists buildings   text[] not null default '{}';

comment on column public.shifts.venue_scope is 'full_venue (default) or partial_venue.';
comment on column public.shifts.buildings   is 'Building names cleaned when venue_scope = partial_venue.';

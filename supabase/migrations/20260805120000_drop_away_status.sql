-- ============================================================================
-- Remove the "away" status
-- ============================================================================
-- "Away" duplicated "inactive" in every way that mattered — both stopped shift
-- offers (is_active false), and the distinction wasn't used operationally. It
-- is gone from the UI; this collapses any remaining rows and locks the columns
-- down to the statuses that are left.
--   cleaners.status  — active | inactive
--   profiles.status  — invite_sent | active | inactive
-- ============================================================================

update public.cleaners set status = 'inactive', is_active = false where status = 'away';
update public.profiles set status = 'inactive', is_active = false where status = 'away';

alter table public.cleaners drop constraint if exists cleaners_status_check;
alter table public.cleaners
  add constraint cleaners_status_check check (status in ('active', 'inactive'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('invite_sent', 'active', 'inactive'));

comment on column public.cleaners.status is 'active | inactive. Only active cleaners are offered shifts.';
comment on column public.profiles.status is 'invite_sent | active | inactive.';

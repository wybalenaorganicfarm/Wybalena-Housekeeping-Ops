-- ============================================================================
-- Cleaner availability status
-- ============================================================================
-- Shift offers go ONLY to active cleaners. away / inactive are skipped. is_active
-- is kept in sync (true only when active) so the offer engine (which filters on
-- is_active) automatically excludes away/inactive cleaners.
--   active   — available, receives shift offers
--   away     — temporarily unavailable (no offers)
--   inactive — not on rotation (no offers)
-- ============================================================================

alter table public.cleaners
  add column if not exists status text not null default 'active';

update public.cleaners set status = 'inactive' where not is_active;

comment on column public.cleaners.status is 'active | away | inactive. Only active cleaners are offered shifts.';

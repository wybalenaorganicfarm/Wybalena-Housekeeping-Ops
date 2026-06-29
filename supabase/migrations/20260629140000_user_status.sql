-- ============================================================================
-- User lifecycle status
-- ============================================================================
-- profiles.is_active (boolean) was too coarse. Add a richer status:
--   invite_sent — invited, has not accepted yet (cannot sign in)
--   active      — accepted, normal access
--   away        — temporarily away (still has access)
--   inactive    — access revoked
-- is_active is kept in sync (true unless inactive) for backward compatibility.
-- ============================================================================

alter table public.profiles
  add column if not exists status text not null default 'active';

comment on column public.profiles.status is 'invite_sent | active | away | inactive.';

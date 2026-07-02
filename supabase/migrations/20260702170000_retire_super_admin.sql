-- ============================================================================
-- Retire the super_admin role — the app now has just two roles: admin (full
-- access) and team_leader. Migrate the legacy owner account to admin.
-- The enum value is left in place (Postgres can't easily drop enum values) but
-- is no longer assignable from the UI or used for gating.
-- ============================================================================

update public.profiles set role = 'admin' where role = 'super_admin';

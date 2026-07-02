-- ============================================================================
-- Access model update:
--   • admin == super_admin for access (full CRUD, incl. user management). The
--     super_admin label is kept only as the hard-coded, unremovable owner.
--   • team_leader: read everything it already could, PLUS may add cleaner notes
--     (status changes go through the set-cleaner-status Edge Function).
-- ============================================================================

-- --- profiles: admin + super_admin full CRUD (was super_admin only + admin read)
drop policy if exists profiles_super_admin_all on public.profiles;
drop policy if exists profiles_admin_select   on public.profiles;
create policy profiles_admin_all on public.profiles
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));
-- profiles_self_select (id = auth.uid()) stays as-is for team_leader.

-- --- bookings: admin + super_admin full (was super_admin full + others read) ---
drop policy if exists bookings_super_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));
-- bookings_read_all (all three roles) stays.

-- --- cleaner_notes: let team_leader add notes (insert). admin_write stays. ----
create policy cleaner_notes_lead_insert on public.cleaner_notes
  for insert with check (auth_role() = 'team_leader');

-- ============================================================================
-- Grant the Operations Manager the SAME access as Admin, by adding
-- 'operations_manager' to every admin-gating RLS policy. Runs after the enum
-- value is committed (previous migration). Drop + recreate each policy.
-- ============================================================================

-- profiles (full CRUD / user management) — recreates roles_access.sql policy.
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- bookings — recreates roles_access.sql policy.
drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- cleaners
drop policy if exists cleaners_admin_write on public.cleaners;
create policy cleaners_admin_write on public.cleaners
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- shifts
drop policy if exists shifts_admin_write on public.shifts;
create policy shifts_admin_write on public.shifts
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- shift_assignments
drop policy if exists shift_assignments_admin_write on public.shift_assignments;
create policy shift_assignments_admin_write on public.shift_assignments
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- alerts
drop policy if exists alerts_admin_write on public.alerts;
create policy alerts_admin_write on public.alerts
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- cleaner_notes (write)
drop policy if exists cleaner_notes_admin_write on public.cleaner_notes;
create policy cleaner_notes_admin_write on public.cleaner_notes
  for all   using (auth_role() in ('admin','super_admin','operations_manager'))
            with check (auth_role() in ('admin','super_admin','operations_manager'));

-- audit_logs (read) — System Logs page.
drop policy if exists admins_read_audit_logs on public.audit_logs;
create policy admins_read_audit_logs on public.audit_logs
  for select using (auth_role() in ('super_admin','admin','operations_manager'));

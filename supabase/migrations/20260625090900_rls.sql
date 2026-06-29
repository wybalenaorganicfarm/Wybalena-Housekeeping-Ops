-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 10
-- Row Level Security (Spec Section 6)
-- ============================================================================
-- RLS governs the FRONTEND only (anon key + user JWT). Edge Functions use the
-- service-role key and bypass RLS by design for system actions.
--
-- Role matrix:
--   profiles          super_admin: full CRUD (user mgmt) | admin: read | team_leader: read self
--   cleaners          super_admin: full | admin: full | team_leader: SELECT
--   bookings          super_admin: full | admin: read | team_leader: SELECT
--   shifts            super_admin: full | admin: full | team_leader: SELECT
--   shift_assignments super_admin: full | admin: full | team_leader: SELECT
--   alerts            super_admin: full | admin: full | team_leader: SELECT  (open item #5 = SELECT)
-- Views (cleaner_reliability, shift_staffing) follow underlying tables via
-- security_invoker, so they need no policies of their own.
--
-- auth_role() reads the JWT custom claim (fast) with a profiles fallback.
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.cleaners          enable row level security;
alter table public.bookings          enable row level security;
alter table public.shifts            enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.alerts            enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- super_admin: full CRUD (user management is theirs alone).
-- admin:       read all profiles.
-- team_leader: read own profile only.
-- ---------------------------------------------------------------------------
create policy profiles_super_admin_all on public.profiles
  for all   using (auth_role() = 'super_admin') with check (auth_role() = 'super_admin');

create policy profiles_admin_select on public.profiles
  for select using (auth_role() = 'admin');

create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- cleaners : admin + super_admin full; team_leader SELECT
-- ---------------------------------------------------------------------------
create policy cleaners_admin_write on public.cleaners
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));

create policy cleaners_read_all on public.cleaners
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- ---------------------------------------------------------------------------
-- bookings : super_admin full; admin read; team_leader SELECT
-- (Writes to bookings happen via Edge Functions / service-role only.)
-- ---------------------------------------------------------------------------
create policy bookings_super_admin_all on public.bookings
  for all   using (auth_role() = 'super_admin') with check (auth_role() = 'super_admin');

create policy bookings_read_all on public.bookings
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- ---------------------------------------------------------------------------
-- shifts : admin + super_admin full; team_leader SELECT
-- ---------------------------------------------------------------------------
create policy shifts_admin_write on public.shifts
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));

create policy shifts_read_all on public.shifts
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- ---------------------------------------------------------------------------
-- shift_assignments : admin + super_admin full; team_leader SELECT
-- ---------------------------------------------------------------------------
create policy shift_assignments_admin_write on public.shift_assignments
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));

create policy shift_assignments_read_all on public.shift_assignments
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- ---------------------------------------------------------------------------
-- alerts : admin + super_admin full; team_leader SELECT (confirmed open item #5)
-- ---------------------------------------------------------------------------
create policy alerts_admin_write on public.alerts
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));

create policy alerts_read_all on public.alerts
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- ============================================================================
-- Correction: the team leader lives in profiles (role = team_leader), NOT in
-- cleaners. The previous cleaners-based auto-assign trigger can never find them
-- (and shift_assignments.cleaner_id FKs to cleaners, so we can't insert a row
-- for a non-cleaner). Remove the trigger and instead treat the lead as a global
-- reserved slot derived from profiles.
-- ============================================================================

drop trigger if exists trg_assign_team_lead on public.shifts;
drop function if exists public.assign_team_lead_to_shift();

-- Any team_lead assignment rows created by the old trigger/backfill are dead
-- (there were none, since no cleaner was ever flagged) — clean up defensively.
delete from public.shift_assignments where status = 'team_lead';

-- Number of reserved team-lead slots (0 or 1). SECURITY DEFINER so the
-- security_invoker staffing view can read it regardless of the caller's RLS on
-- profiles.
create or replace function public.active_team_lead_slots()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select least(1, count(*))::int
  from public.profiles
  where role = 'team_leader' and is_active = true;
$$;

-- The team lead's identity for the UI (name shown in the staffing meter +
-- responder list). SECURITY DEFINER so admins/team leaders see it even if RLS on
-- profiles is limited to super admins.
create or replace function public.get_team_lead()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(p.full_name, 'Team Lead')
  from public.profiles p
  where p.role = 'team_leader' and p.is_active = true
  limit 1;
$$;

grant execute on function public.active_team_lead_slots() to authenticated, anon;
grant execute on function public.get_team_lead() to authenticated, anon;

-- shift_staffing: lead_count is the reserved lead slot; open_count subtracts it.
drop view if exists public.shift_staffing;
create view public.shift_staffing
with (security_invoker = true) as
select
  s.id as shift_id,
  s.required_cleaners,
  count(sa.id) filter (where sa.status = 'accepted') as accepted_count,
  count(sa.id) filter (where sa.status = 'offered')  as offered_count,
  public.active_team_lead_slots()                    as lead_count,
  greatest(
    s.required_cleaners - public.active_team_lead_slots()
      - count(sa.id) filter (where sa.status = 'accepted'),
    0
  ) as open_count
from public.shifts s
left join public.shift_assignments sa on sa.shift_id = s.id
group by s.id, s.required_cleaners;

comment on view public.shift_staffing is 'Per-shift required vs lead/accepted/offered/open counts; lead_count is the reserved team-lead slot (from profiles).';

-- ============================================================================
-- Team lead is ADDITIVE, not carved out of required_cleaners.
-- required_cleaners = number of cleaners needed; the lead is a separate +1 on
-- top (6 cleaners needed → 1 lead + 6 cleaners). So open_count no longer
-- subtracts the lead slot.
-- ============================================================================

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
    s.required_cleaners - count(sa.id) filter (where sa.status = 'accepted'),
    0
  ) as open_count
from public.shifts s
left join public.shift_assignments sa on sa.shift_id = s.id
group by s.id, s.required_cleaners;

comment on view public.shift_staffing is 'Per-shift cleaner staffing (required_cleaners = cleaners only); lead_count is the additional team-lead slot.';

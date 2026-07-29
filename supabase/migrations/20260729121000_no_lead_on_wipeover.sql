-- ============================================================================
-- The team lead is NOT auto-rostered onto wipeover cleans.
-- Every other clean type keeps her reserved +1 slot; a wipeover is staffed from
-- cleaners only, so the staffing meter reads "n/required" with no lead segment.
-- Separate migration from the enum add — a new enum value can't be *used* in the
-- same transaction that created it (hence the ::text comparison too).
-- ============================================================================

drop view if exists public.shift_staffing;
create view public.shift_staffing
with (security_invoker = true) as
select
  s.id as shift_id,
  s.required_cleaners,
  count(sa.id) filter (where sa.status = 'accepted') as accepted_count,
  count(sa.id) filter (where sa.status = 'offered')  as offered_count,
  case when s.shift_type::text = 'wipeover'
       then 0
       else public.active_team_lead_slots()
  end as lead_count,
  greatest(
    s.required_cleaners - count(sa.id) filter (where sa.status = 'accepted'),
    0
  ) as open_count
from public.shifts s
left join public.shift_assignments sa on sa.shift_id = s.id
group by s.id, s.required_cleaners, s.shift_type;

comment on view public.shift_staffing is 'Per-shift cleaner staffing (required_cleaners = cleaners only); lead_count is the additional team-lead slot, always 0 for wipeover cleans.';

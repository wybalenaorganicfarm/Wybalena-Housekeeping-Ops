-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 9
-- Helper views: cleaner_reliability, shift_staffing
-- ============================================================================
-- Views run with the privileges of the querying user (security_invoker) so RLS
-- on the underlying tables still applies — required on PG15+ for views to
-- respect caller RLS rather than the view owner's.
-- ============================================================================

-- --- cleaner_reliability ------------------------------------------------------
-- Per cleaner: accepted / declined / cancelled counts derived from
-- shift_assignments, ROLLING 30-DAY (counts only responses in the last 30 days,
-- keyed on responded_at). Powers the directory's reliability column.
-- SWAP POINT: to revert to lifetime counts, drop the responded_at predicate
-- from each filter (open item #4).
create view public.cleaner_reliability
with (security_invoker = true) as
select
  c.id   as cleaner_id,
  c.full_name,
  c.tier,
  count(*) filter (
    where sa.status = 'accepted'
      and sa.responded_at >= now() - interval '30 days'
  ) as accepted_count,
  count(*) filter (
    where sa.status = 'declined'
      and sa.responded_at >= now() - interval '30 days'
  ) as declined_count,
  count(*) filter (
    where sa.status = 'cancelled'
      and sa.responded_at >= now() - interval '30 days'
  ) as cancelled_count
from public.cleaners c
left join public.shift_assignments sa on sa.cleaner_id = c.id
group by c.id, c.full_name, c.tier;

comment on view public.cleaner_reliability is 'Derived accepted/declined/cancelled counts per cleaner, rolling 30-day by responded_at (see SWAP POINT for lifetime).';

-- --- shift_staffing -----------------------------------------------------------
-- Per shift: required vs accepted vs offered vs open. Powers the dashboard's
-- required-vs-assigned meter without per-row counting in the frontend.
create view public.shift_staffing
with (security_invoker = true) as
select
  s.id as shift_id,
  s.required_cleaners,
  count(sa.id) filter (where sa.status = 'accepted') as accepted_count,
  count(sa.id) filter (where sa.status = 'offered')  as offered_count,
  greatest(
    s.required_cleaners - count(sa.id) filter (where sa.status = 'accepted'),
    0
  ) as open_count
from public.shifts s
left join public.shift_assignments sa on sa.shift_id = s.id
group by s.id, s.required_cleaners;

comment on view public.shift_staffing is 'Per-shift required vs accepted/offered/open counts for the staffing meter.';

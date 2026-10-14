-- ============================================================================
-- Switch cleaner_reliability from rolling 30-day to LIFETIME counts.
--
-- The directory's reliability column shows accepted / declined / cancelled per
-- cleaner. These were originally scoped to the last 30 days (the "SWAP POINT" in
-- 20260625090700_views.sql). The venue wants Airtable parity: lifetime totals, so
-- a cleaner's whole history is reflected, not just the last month.
--
-- Only change vs 20260625090700_views.sql: the `responded_at >= now() - interval
-- '30 days'` predicate is removed from each filter. Everything else is verbatim.
-- ============================================================================

create or replace view public.cleaner_reliability
with (security_invoker = true) as
select
  c.id   as cleaner_id,
  c.full_name,
  c.tier,
  count(*) filter (where sa.status = 'accepted')  as accepted_count,
  count(*) filter (where sa.status = 'declined')  as declined_count,
  count(*) filter (where sa.status = 'cancelled') as cancelled_count
from public.cleaners c
left join public.shift_assignments sa on sa.cleaner_id = c.id
group by c.id, c.full_name, c.tier;

comment on view public.cleaner_reliability is 'Derived accepted/declined/cancelled counts per cleaner, LIFETIME (was rolling 30-day; switched 2026-10-14 for Airtable parity).';

-- ============================================================================
-- Auto-assign the team leader to every shift + reflect their reserved slot in
-- the shift_staffing view.
-- ============================================================================
-- Rules:
--   1. On shift creation the team leader (cleaners.is_team_leader) gets a
--      shift_assignments row with status 'team_lead' — no WhatsApp offer is sent
--      (the offer engine only messages 'offered' rows).
--   2. Their slot counts as filled: required_cleaners already budgets for the
--      lead (Zara + N), so offers go out only for the remaining N cleaner slots.
--   3. The UI shows "1 + n / required" and lists the lead with a "Team Lead"
--      status instead of accepted/offered/etc.
-- ============================================================================

-- --- Trigger: assign the lead whenever a shift is created --------------------
create or replace function public.assign_team_lead_to_shift()
returns trigger
language plpgsql
as $$
declare
  lead_id   uuid;
  lead_tier cleaner_tier;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select id, tier into lead_id, lead_tier
  from public.cleaners
  where is_team_leader = true and is_active = true
  limit 1;

  if lead_id is not null then
    insert into public.shift_assignments
      (shift_id, cleaner_id, tier_at_offer, status, responded_at)
    values
      (new.id, lead_id, lead_tier, 'team_lead', now())
    on conflict (shift_id, cleaner_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_team_lead on public.shifts;
create trigger trg_assign_team_lead
  after insert on public.shifts
  for each row execute function public.assign_team_lead_to_shift();

-- --- Backfill: existing live shifts without a team-lead assignment -----------
insert into public.shift_assignments
  (shift_id, cleaner_id, tier_at_offer, status, responded_at)
select s.id, lead.id, lead.tier, 'team_lead', now()
from public.shifts s
cross join lateral (
  select id, tier from public.cleaners
  where is_team_leader = true and is_active = true
  limit 1
) lead
where s.status <> 'cancelled'
  and not exists (
    select 1 from public.shift_assignments sa
    where sa.shift_id = s.id and sa.cleaner_id = lead.id
  );

-- --- shift_staffing: surface the lead slot + adjust open count ---------------
-- accepted_count / offered_count stay cleaner-only. lead_count is the reserved
-- team-lead slot (0 or 1). open_count now subtracts the lead's slot too.
drop view if exists public.shift_staffing;
create view public.shift_staffing
with (security_invoker = true) as
select
  s.id as shift_id,
  s.required_cleaners,
  count(sa.id) filter (where sa.status = 'accepted')  as accepted_count,
  count(sa.id) filter (where sa.status = 'offered')   as offered_count,
  count(sa.id) filter (where sa.status = 'team_lead') as lead_count,
  greatest(
    s.required_cleaners
      - count(sa.id) filter (where sa.status = 'team_lead')
      - count(sa.id) filter (where sa.status = 'accepted'),
    0
  ) as open_count
from public.shifts s
left join public.shift_assignments sa on sa.shift_id = s.id
group by s.id, s.required_cleaners;

comment on view public.shift_staffing is 'Per-shift required vs lead/accepted/offered/open counts for the staffing meter.';

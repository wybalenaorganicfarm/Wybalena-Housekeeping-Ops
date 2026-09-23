-- ============================================================================
-- Allow MULTIPLE Cleaning Managers.
--
-- Until now the role was single-holder: set_cleaning_manager() stepped down
-- every other holder, and clear_cleaning_manager() unflagged all of them. The
-- venue wants more than one person to hold the role at the same time — each
-- auto-rostered onto every upcoming standard shift, each receiving the
-- "you've been rostered" message, and stepping one down must leave the others
-- untouched.
--
-- WHAT CHANGES
--   1. set_cleaning_manager(uuid) no longer clears other holders. It just flags
--      the nominee and backfills them. Nominating is now ADDITIVE.
--   2. NEW clear_one_cleaning_manager(uuid) steps down ONE named holder and
--      drops only THAT person's upcoming roster rows.
--   3. clear_cleaning_manager() is kept, unchanged in meaning (clear EVERYONE),
--      because the deactivate/remove guards and "clear the role entirely" still
--      want it. It is no longer what a single step-down calls.
--
-- WHAT DOES NOT CHANGE
--   * WIPEOVER stays excluded from auto-roster. On a wipeover a manager is a
--     working cleaner who fills a slot and is assigned by hand — auto-rostering
--     several of them would over-staff a one-cleaner job and double-message.
--   * The roster TRIGGER (trg_roster_manager) already inserts one row per
--     flagged manager? NO — it used `limit 1`. It is replaced below so every
--     manager gets a row on a newly created shift.
--   * shift_staffing.lead_count is driven by active_team_lead_slots(), which
--     reads profiles.role='team_leader' (a DIFFERENT table) and caps at 1. It is
--     untouched by this migration, so the staffing meter cannot be inflated by
--     having several cleaners flagged here.
-- ============================================================================

-- 1. Nomination becomes additive: flag + backfill only, no step-down of others.
create or replace function public.set_cleaning_manager(p_cleaner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
  v_tier  cleaner_tier;
begin
  -- Guard: the nominee must be an existing, active cleaner.
  select tier into v_tier
  from public.cleaners
  where id = p_cleaner_id and is_active = true;
  if v_tier is null then
    raise exception 'nominee is not an active cleaner';
  end if;

  -- Flag the new holder. Other holders are deliberately LEFT ALONE — the role
  -- is multi-holder now, so nominating a second manager adds to the set rather
  -- than replacing the first.
  update public.cleaners
  set is_team_leader = true
  where id = p_cleaner_id;

  -- Backfill onto upcoming, non-cancelled, non-wipeover shifts, with
  -- lead_notified_at = now() so notify-manager-roster SKIPS them: existing work
  -- is rostered silently, no message blast for shifts already on the books.
  --
  -- on conflict do nothing is DELIBERATE: if they already have a row on a shift
  -- — e.g. they previously ACCEPTED it as a normal cleaner — that real staffing
  -- accept must NOT be downgraded to a reserved team_lead slot.
  insert into public.shift_assignments
    (shift_id, cleaner_id, tier_at_offer, status, responded_at, lead_notified_at)
  select s.id, p_cleaner_id, v_tier, 'team_lead', now(), now()
  from public.shifts s
  where s.shift_date >= v_today
    and s.status <> 'cancelled'
    and s.shift_type::text <> 'wipeover'
  on conflict (shift_id, cleaner_id) do nothing;
end;
$$;

-- 2. Step down ONE holder, leaving any other managers in place.
create or replace function public.clear_one_cleaning_manager(p_cleaner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  -- Drop only THIS person's upcoming reservation rows. Past shifts are left
  -- untouched so history stays accurate, and rows belonging to other managers
  -- are not matched.
  delete from public.shift_assignments sa
  using public.shifts s
  where sa.shift_id = s.id
    and sa.cleaner_id = p_cleaner_id
    and sa.status = 'team_lead'
    and s.shift_date >= v_today
    and s.status <> 'cancelled';

  update public.cleaners
  set is_team_leader = false
  where id = p_cleaner_id;
end;
$$;

-- 3. The roster trigger must add a row for EVERY manager, not just one. The
--    previous version selected a single manager with `limit 1`, which would
--    silently roster only one of several onto each new shift.
create or replace function public.roster_manager_on_shift()
returns trigger
language plpgsql
as $$
begin
  -- A shift created already-cancelled is never rostered.
  if new.status = 'cancelled' then return new; end if;
  -- Wipeover: manual-assign only, no auto-roster. ::text so this compiles even
  -- in a transaction where the enum value was freshly added.
  if new.shift_type::text = 'wipeover' then return new; end if;

  -- One reservation row per active manager. lead_notified_at stays null so
  -- notify-manager-roster picks each of them up and sends the rostered message.
  insert into public.shift_assignments
    (shift_id, cleaner_id, tier_at_offer, status, responded_at)
  select new.id, cl.id, cl.tier, 'team_lead', now()
  from public.cleaners cl
  where cl.is_team_leader = true and cl.is_active = true
  on conflict (shift_id, cleaner_id) do nothing;

  return new;
end;
$$;

revoke all on function public.clear_one_cleaning_manager(uuid) from public, anon, authenticated;
grant execute on function public.clear_one_cleaning_manager(uuid) to service_role;

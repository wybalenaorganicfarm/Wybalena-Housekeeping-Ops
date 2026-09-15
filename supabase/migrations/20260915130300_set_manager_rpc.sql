-- ============================================================================
-- set_cleaning_manager(p_cleaner_id) / clear_cleaning_manager() — atomically
-- (re)nominate or clear the Cleaning Manager. Each runs in one implicit
-- transaction, so a partial re-nomination can never leave two managers or
-- orphaned roster rows.
--
-- set_cleaning_manager steps, in order:
--   1. CLEAR the previous holder: unflag every OTHER is_team_leader cleaner, and
--      delete their status='team_lead' roster rows for UPCOMING, non-cancelled
--      shifts (they are no longer rostered on future work). Past shifts are left
--      untouched — history stays accurate.
--   2. SET the new holder: flag p_cleaner_id is_team_leader = true.
--   3. BACKFILL the new holder onto existing UPCOMING, non-cancelled, non-wipeover
--      shifts, with lead_notified_at = now() so notify-manager-roster SKIPS them
--      — she is rostered silently, no message blast. New shifts from now on are
--      rostered (and messaged) by the trg_roster_manager trigger as normal.
--
-- "Upcoming" = shift_date >= venue-local today (Australia/Sydney), matching the
-- datetime.ts venueDay idiom. Wipeover is excluded from the backfill for the same
-- reason the trigger excludes it (manual-assign only).
--
-- SECURITY DEFINER + service_role-only grant: callable ONLY through the
-- set-manager edge function (which does the authz check), never directly from a
-- client. Mirrors admin_set_cron_schedule.
-- ============================================================================

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

  -- 1. Clear the previous holder(s): drop their FUTURE roster rows (matched by the
  --    row's cleaner, not the flag), then unflag. Only upcoming, non-cancelled
  --    shifts; past history is preserved.
  delete from public.shift_assignments sa
  using public.shifts s, public.cleaners cl
  where sa.shift_id = s.id
    and sa.cleaner_id = cl.id
    and cl.is_team_leader = true
    and cl.id <> p_cleaner_id
    and sa.status = 'team_lead'
    and s.shift_date >= v_today
    and s.status <> 'cancelled';

  update public.cleaners
  set is_team_leader = false
  where is_team_leader = true and id <> p_cleaner_id;

  -- 2. Set the new holder.
  update public.cleaners
  set is_team_leader = true
  where id = p_cleaner_id;

  -- 3. Backfill the new holder onto upcoming, non-cancelled, non-wipeover shifts.
  --    lead_notified_at = now() so the notify cron does NOT message her for these
  --    (silent roster of existing work).
  --
  --    on conflict do nothing is DELIBERATE, not a bug to "fix": if she already
  --    has a row on a shift — e.g. she previously ACCEPTED it as a normal cleaner
  --    — that real staffing accept must NOT be downgraded to a reserved team_lead
  --    slot. On that one shift she stays a counted cleaner. Leave it.
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

-- Clear the Cleaning Manager entirely (no replacement). Unflag every holder and
-- drop their upcoming roster rows. Same transaction/atomicity guarantees. Called
-- on step-down, and by the deactivate/remove guards so removing the manager can't
-- leave a dangling flag or orphaned team_lead rows.
create or replace function public.clear_cleaning_manager()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  delete from public.shift_assignments sa
  using public.shifts s, public.cleaners cl
  where sa.shift_id = s.id
    and sa.cleaner_id = cl.id
    and cl.is_team_leader = true
    and sa.status = 'team_lead'
    and s.shift_date >= v_today
    and s.status <> 'cancelled';

  update public.cleaners set is_team_leader = false where is_team_leader = true;
end;
$$;

revoke all on function public.set_cleaning_manager(uuid) from public, anon, authenticated;
revoke all on function public.clear_cleaning_manager() from public, anon, authenticated;
grant execute on function public.set_cleaning_manager(uuid) to service_role;
grant execute on function public.clear_cleaning_manager() to service_role;

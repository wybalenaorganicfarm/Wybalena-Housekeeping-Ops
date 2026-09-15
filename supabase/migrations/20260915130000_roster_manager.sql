-- ============================================================================
-- Cleaning Manager auto-roster: on every non-wipeover shift, the nominated
-- manager (cleaners.is_team_leader = true) gets a shift_assignments row with
-- status 'team_lead' — reserved-and-filled, NEVER offered, and invisible to
-- acceptedCount (which counts only status='accepted'), so it can't inflate the
-- staffing meter. A separate notify cron (notify-manager-roster) then sends the
-- pure "you've been rostered" WhatsApp for rows it hasn't announced yet.
--
-- WIPEOVER is DELIBERATELY excluded here. On a wipeover the manager is instead
-- MANUALLY assigned as a working cleaner (she counts toward required_cleaners),
-- so an auto-roster row would both double-message her and wrongly reserve a slot.
-- This mirrors the existing no_lead_on_wipeover carve-out (lead_count = 0 there).
--
-- This migration installs the MECHANISM only — it NEVER names a person. Who the
-- manager is stays a runtime nomination (Cleaners page -> set-manager), so the
-- role is reassignable with no schema change. There is deliberately NO BACKFILL
-- of existing shifts here: the trigger fires on INSERT only, so nominating a
-- manager does not retro-roster past shifts. Sweeping existing UPCOMING shifts is
-- done transactionally inside set-manager (a later piece), where it belongs —
-- nomination is the event that changes "who is the manager".
--
-- ON CONFLICT target: shift_assignments has a unique constraint
-- shift_assignments_shift_cleaner_unique (shift_id, cleaner_id) — see
-- 20260625090500_shift_assignments.sql — so the dedupe below is valid.
-- ============================================================================

-- Marks when the notify cron has announced a roster row, so a re-run never
-- double-messages the manager. Null = not yet announced (the cron's work-queue).
alter table public.shift_assignments
  add column if not exists lead_notified_at timestamptz;

create or replace function public.roster_manager_on_shift()
returns trigger
language plpgsql
as $$
declare
  mgr_id   uuid;
  mgr_tier cleaner_tier;
begin
  -- A shift created already-cancelled is never rostered.
  if new.status = 'cancelled' then return new; end if;
  -- Wipeover: manual-assign only, no auto-roster (Decision 2). ::text so this
  -- compiles even in a transaction where the enum value was freshly added.
  if new.shift_type::text = 'wipeover' then return new; end if;

  -- Exactly one manager by convention; LIMIT 1 degrades safely to "one of them"
  -- if two rows were ever flagged. set-manager enforces single-holder atomically,
  -- so this never actually has to choose.
  select id, tier into mgr_id, mgr_tier
  from public.cleaners
  where is_team_leader = true and is_active = true
  limit 1;

  -- No nominated manager (or she has no active cleaner row yet) -> nothing to do.
  if mgr_id is not null then
    insert into public.shift_assignments
      (shift_id, cleaner_id, tier_at_offer, status, responded_at)
    values
      -- tier_at_offer is NOT NULL; stamp her cleaner-row tier. It is never read
      -- for a team_lead-status row, but it satisfies the constraint. responded_at
      -- is stamped because a roster row is settled, not awaiting a reply — both
      -- mirror the retired auto_assign_team_lead trigger.
      (new.id, mgr_id, mgr_tier, 'team_lead', now())
    -- lead_notified_at defaults to null -> notify-manager-roster picks it up.
    -- on conflict: if she somehow already has a row on this shift, leave it.
    on conflict (shift_id, cleaner_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_roster_manager on public.shifts;
create trigger trg_roster_manager
  after insert on public.shifts
  for each row execute function public.roster_manager_on_shift();

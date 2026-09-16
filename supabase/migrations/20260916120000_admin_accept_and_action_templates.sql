-- ============================================================================
-- admin_accept_slot — atomic admin "add as accepted" (no offer sent)
-- ============================================================================
-- The ONLY path that writes status='accepted' outside claim_shift_slot. It must
-- take the SAME shift-row lock, or it reintroduces the exact race that lock was
-- built to close: between an unlocked count-check and the write, a cleaner's
-- WhatsApp Accept can land through claim_shift_slot and over-staff the shift
-- (accepted > required_cleaners). So the count re-check happens UNDER the lock,
-- mirroring accept_offer_atomic.sql.
--
-- Differences from claim_shift_slot: no prior offer is required (this admits a
-- cleaner who was never offered), so it upserts the row to 'accepted' rather than
-- transitioning an existing offered/no_response row. Guards:
--   • hard block at required_cleaners (no over-staffing; no force path)
--   • refuses a team_lead row EXCEPT on wipeover (where she's a working cleaner) —
--     guarded here, under the lock, atomic with the count check
--   • stamps tier_at_offer from the cleaner's current tier (NOT NULL column)
-- Returns: 'accepted' | 'full' | 'team_lead' | 'error'. The caller runs
-- recomputeStaffing after 'accepted' (marks the shift fully_staffed when met).
-- ============================================================================

create or replace function public.admin_accept_slot(
  p_shift_id   uuid,
  p_cleaner_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required   int;
  v_shift_stat shift_status;
  v_shift_type shift_type;
  v_accepted   int;
  v_tier       cleaner_tier;
  v_is_lead    boolean;
  v_existing   assignment_status;
begin
  -- Lock the shift row FIRST — concurrent claims (admin or claim_shift_slot)
  -- on the same shift serialize here, exactly as in claim_shift_slot.
  select s.required_cleaners, s.status, s.shift_type
    into v_required, v_shift_stat, v_shift_type
    from public.shifts s
   where s.id = p_shift_id
   for update;

  if v_shift_stat is null or v_shift_stat = 'cancelled' then
    return 'error';
  end if;

  -- The cleaner must exist and be active; carry their tier + lead flag.
  select c.tier, c.is_team_leader
    into v_tier, v_is_lead
    from public.cleaners c
   where c.id = p_cleaner_id
     and c.is_active = true;
  if v_tier is null then
    return 'error';
  end if;

  -- The Cleaning Manager's slot is a roster reservation, not a working spot —
  -- refuse, EXCEPT on a wipeover where she cleans like anyone else. Under the
  -- lock so it's atomic with the count check.
  if v_is_lead and v_shift_type <> 'wipeover' then
    return 'team_lead';
  end if;

  -- If she already holds a team_lead reservation row on this shift, never
  -- overwrite it here (a non-wipeover would have returned above; this covers a
  -- wipeover row that shouldn't exist, defensively).
  select a.status into v_existing
    from public.shift_assignments a
   where a.shift_id = p_shift_id and a.cleaner_id = p_cleaner_id;
  if v_existing = 'team_lead' then
    return 'team_lead';
  end if;

  -- Already accepted here? Idempotent success, no double-count.
  if v_existing = 'accepted' then
    return 'accepted';
  end if;

  -- Count accepted UNDER the lock: no other claim on this shift can commit
  -- between this read and our write. Hard block at required — no over-staffing.
  select count(*)
    into v_accepted
    from public.shift_assignments
   where shift_id = p_shift_id
     and status = 'accepted';

  if v_accepted >= v_required then
    return 'full';
  end if;

  -- Promote any prior offered/declined/cancelled/no_response/send_failed row
  -- straight to accepted, or create one — on (shift_id, cleaner_id).
  insert into public.shift_assignments
    (shift_id, cleaner_id, tier_at_offer, status, is_manual_override, responded_at)
  values
    (p_shift_id, p_cleaner_id, v_tier, 'accepted', true, now())
  on conflict (shift_id, cleaner_id) do update
    set status = 'accepted',
        is_manual_override = true,
        responded_at = now();

  return 'accepted';
end;
$$;

comment on function public.admin_accept_slot(uuid, uuid) is
  'Atomically add a cleaner as accepted (admin, no offer sent) under a shift-row lock. Hard-blocks at required_cleaners, refuses a team_lead row except on wipeover. Returns accepted | full | team_lead | error.';

-- Callable by the service role (edge functions) only; not exposed to anon/auth.
revoke all on function public.admin_accept_slot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_accept_slot(uuid, uuid) to service_role;

-- ============================================================================
-- Three admin-action notification templates (plain text, no buttons)
-- ============================================================================
-- Sent best-effort by the new admin endpoints (withdraw-offer, cancel-accepted,
-- add-accepted) as the cleaner-facing consequence of an admin state change. Same
-- contract as every other template: the endpoint carries a built-in fallback, so
-- a missing or edited row can never stop the send. Category "Offer & acceptance"
-- (1-9) — they are the admin-side counterparts of the offer/accept flow.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'offer_withdrawn',
    'Offer & acceptance',
    'Offer withdrawn (admin)',
    'Sent to a cleaner when an admin withdraws an offer they had not yet accepted, so a stale Accept tap does not confuse them.',
    E'This offer for the {{shift_date}} shift is no longer available.',
    null, 'Wybalena Organic Farm', null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"}]'::jsonb,
    6
  ),
  (
    'removed_from_shift',
    'Offer & acceptance',
    'Removed from shift (admin)',
    'Sent to a cleaner when an admin takes them off a shift they had accepted. They are told immediately rather than finding out from the roster.',
    E'You''ve been taken off the {{shift_date}} shift.',
    null, 'Wybalena Organic Farm', null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"}]'::jsonb,
    7
  ),
  (
    'booked_manually',
    'Offer & acceptance',
    'Booked manually (admin)',
    'Sent to a cleaner when an admin adds them to a shift as accepted without an offer, so they know they are now on the shift.',
    E'You''ve been booked for the {{shift_date}} shift.',
    null, 'Wybalena Organic Farm', null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"}]'::jsonb,
    8
  )
on conflict (key) do nothing;

-- Snapshot the seeded copy so "Reset to default" works on these rows too.
update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
)
where key in ('offer_withdrawn', 'removed_from_shift', 'booked_manually')
  and (defaults = '{}'::jsonb or defaults is null);

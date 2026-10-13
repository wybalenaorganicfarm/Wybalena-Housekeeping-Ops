-- ============================================================================
-- Allow a cleaner to ACCEPT a shift she has just DECLINED (one-tap-decline undo).
--
-- The decline flow is being simplified from a two-step confirm ("Decline" →
-- "are you sure?" Yes/No) to a single tap that declines immediately and offers an
-- "Accept offer" button to undo a mis-tap. For that Accept to work, claim_shift_slot
-- must treat a `declined` row as claimable, not just `offered` / `no_response`.
--
-- This is safe:
--   • First-come-wins is unchanged — the accept still runs under the shift-row
--     lock and the count check, so a reversed decline can only take a slot that is
--     genuinely still open; if the shift filled meanwhile she gets 'already_full'.
--   • It only ever lets a cleaner re-claim an offer that was hers — the assignment
--     row is already tied to her. It does not create access to any new shift.
--   • `accepted` / `cancelled` / `team_lead` / `send_failed` stay NON-claimable, so
--     this does not resurrect a cancelled spot or double-accept.
--
-- Everything else in the function is copied verbatim from
-- 20260914130000_accept_offer_atomic.sql — only the status guard on line "not in"
-- gains 'declined'.
-- ============================================================================

create or replace function public.claim_shift_slot(p_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id   uuid;
  v_status     assignment_status;
  v_required   int;
  v_shift_stat shift_status;
  v_accepted   int;
begin
  select a.shift_id, a.status
    into v_shift_id, v_status
    from public.shift_assignments a
   where a.id = p_assignment_id;

  if v_shift_id is null then
    return 'closed';
  end if;

  select s.required_cleaners, s.status
    into v_required, v_shift_stat
    from public.shifts s
   where s.id = v_shift_id
   for update;

  if v_shift_stat is null
     or v_shift_stat = 'cancelled'
     or v_shift_stat = 'fully_staffed' then
    return 'closed';
  end if;

  -- Claimable states: a live offer, a lapsed one, OR a just-declined one the
  -- cleaner is reversing (the undo on the simplified decline flow).
  if v_status not in ('offered', 'no_response', 'declined') then
    return 'closed';
  end if;

  select count(*)
    into v_accepted
    from public.shift_assignments
   where shift_id = v_shift_id
     and status = 'accepted';

  if v_accepted >= v_required then
    update public.shift_assignments
       set status = 'no_response', responded_at = now()
     where id = p_assignment_id;
    return 'already_full';
  end if;

  update public.shift_assignments
     set status = 'accepted', responded_at = now()
   where id = p_assignment_id;
  return 'accepted';
end;
$$;

revoke all on function public.claim_shift_slot(uuid) from public, anon, authenticated;
grant execute on function public.claim_shift_slot(uuid) to service_role;

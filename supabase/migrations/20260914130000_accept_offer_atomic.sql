-- ============================================================================
-- Atomic first-come-wins shift acceptance
-- ============================================================================
-- acceptOffer previously counted accepted rows, then, in a SEPARATE statement,
-- set the accepting row to 'accepted'. Two concurrent accepts for the last open
-- slot could both read "one spot left" and both write 'accepted', over-staffing
-- the shift (accepted > required_cleaners).
--
-- claim_shift_slot does the count-and-set in ONE statement under a row lock on
-- the parent shift, so exactly one of two racing accepts wins. It returns:
--   'accepted'      - this assignment now holds a slot
--   'already_full'  - the shift filled first; the row is marked no_response
--   'closed'        - the shift/row is gone, cancelled, already full, or the row
--                     is not in an acceptable state (offered / no_response)
-- Staffing recompute (marking the shift fully_staffed) stays in application code,
-- which runs after a successful claim.
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
  -- Resolve the assignment and its shift.
  select a.shift_id, a.status
    into v_shift_id, v_status
    from public.shift_assignments a
   where a.id = p_assignment_id;

  if v_shift_id is null then
    return 'closed';
  end if;

  -- Lock the shift row so concurrent claims on the same shift serialize here.
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

  -- Only an open row can be accepted.
  if v_status not in ('offered', 'no_response') then
    return 'closed';
  end if;

  -- Count under the lock: no other claim on this shift can commit between here
  -- and our update.
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

comment on function public.claim_shift_slot(uuid) is
  'Atomically accept a shift assignment under a shift-row lock (first-come-wins). Returns accepted | already_full | closed.';

-- Callable by the service role (edge functions) only; not exposed to anon/auth.
revoke all on function public.claim_shift_slot(uuid) from public, anon, authenticated;
grant execute on function public.claim_shift_slot(uuid) to service_role;

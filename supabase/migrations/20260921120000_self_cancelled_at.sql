-- ============================================================================
-- shift_assignments: self_cancelled_at
-- ============================================================================
-- Records the moment a cleaner cancelled her OWN accepted shift from WhatsApp,
-- as distinct from an admin taking her off it (cancel-accepted). Both write
-- status='cancelled', so until now the two were indistinguishable — and the
-- last-resort re-offer sweep (engine.reofferToUnaccepted) handed the shift
-- straight back to the cleaner who had just dropped it.
--
-- Nullable and additive: an admin removal leaves it null, which keeps that
-- cleaner eligible for the sweep (correct — she did not turn the shift down).
-- ============================================================================

alter table public.shift_assignments
  add column if not exists self_cancelled_at timestamptz;

comment on column public.shift_assignments.self_cancelled_at is
  'Set when the CLEANER cancelled her own accepted shift (WhatsApp "Yes, cancel"). Null for admin removals. Excludes her from the post-cancellation re-offer sweep for this shift.';

-- The sweep filters on it per shift; a partial index keeps that lookup cheap
-- without carrying the overwhelming majority of rows where it is null.
create index if not exists shift_assignments_self_cancelled_idx
  on public.shift_assignments (shift_id)
  where self_cancelled_at is not null;

-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 7
-- shift_assignments (the heart of the system)
-- ============================================================================
-- One row per cleaner offered a given shift. Holds offer state + tier-escalation
-- history. Unique (shift_id, cleaner_id). Assigned count for a shift = rows with
-- status = accepted. Tier escalation = successive batches of rows keyed on
-- tier_at_offer. Re-assignment on cancel = mark cancelled + insert new offered
-- rows for remaining available cleaners.
-- ============================================================================

create table public.shift_assignments (
  id                  uuid primary key default gen_random_uuid(),
  shift_id            uuid not null references public.shifts (id) on delete cascade,
  cleaner_id          uuid not null references public.cleaners (id) on delete restrict,
  tier_at_offer       cleaner_tier not null,
  status              assignment_status not null default 'offered',
  offered_at          timestamptz not null default now(),
  responded_at        timestamptz,
  reminder_sent_at    timestamptz,                    -- the +18h non-responder reminder
  is_manual_override  boolean not null default false, -- Ashley assigned directly
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint shift_assignments_shift_cleaner_unique unique (shift_id, cleaner_id)
);

comment on table public.shift_assignments is 'One row per cleaner per shift offer. Accepted count vs shifts.required_cleaners drives staffing.';

create trigger trg_shift_assignments_updated_at
  before update on public.shift_assignments
  for each row execute function public.set_updated_at();

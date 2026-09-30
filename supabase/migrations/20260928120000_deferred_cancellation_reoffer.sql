-- ============================================================================
-- Deferred cancellation re-offers.
--
-- WHY
--   Until now, when a cleaner cancelled (or an admin removed one), the freed spot
--   was handled the instant it happened: either re-offered immediately (once the
--   tier chain was exhausted) or left for the next scheduled escalation. The venue
--   asked for a calmer, more predictable rhythm:
--
--     • A cancellation with MORE than 72h notice should NOT message cleaners at a
--       random hour. Instead the re-offer waits for the next 3pm slot — the same
--       time the normal tier offers go out — so cleaners aren't pinged whenever
--       someone happens to cancel. This applies whether or not the shift has
--       already reached Tier 3; the 3pm run resumes the tier chain from where the
--       shift is up to.
--     • A cancellation with 72h or LESS notice is urgent: the spot goes out
--       immediately to all available cleaners (except the one who just cancelled),
--       because there isn't time to wait for the next 3pm slot.
--
-- HOW
--   A freed spot that must wait is MARKED on the shift (reoffer_pending_at) rather
--   than acted on. A new daily 3pm cron (cancellation-reoffer) sweeps marked
--   shifts, resumes the tier chain / re-offer for each, and clears the mark. The
--   ≤72h immediate path never sets the mark — it re-offers on the spot.
--
--   This is a MARKER, not a queue of individual cancellations: several cancels on
--   one shift before 3pm collapse to a single re-offer that fills every open spot,
--   which is exactly what we want (one message round, not one per canceller).
-- ============================================================================

-- Set when a cancellation's re-offer is deferred to the next 3pm run. Null =
-- nothing pending. Cleared by cancellation-reoffer once it has swept the shift.
alter table public.shifts
  add column if not exists reoffer_pending_at timestamptz;

-- Partial index so the 3pm sweep finds pending shifts without scanning the table.
create index if not exists idx_shifts_reoffer_pending
  on public.shifts (reoffer_pending_at)
  where reoffer_pending_at is not null;

-- The notice threshold that splits "wait for 3pm" from "go out now", editable from
-- the Automation Schedule page like every other timing knob. Stored in the same
-- app_settings table as booking_sync_range / cancellation_cooloff. Seeded here
-- because app_settings has no INSERT RLS policy — rows must arrive via migration.
insert into public.app_settings (key, value, label, description)
values (
  'cancellation_reoffer',
  jsonb_build_object('urgent_within_hours', 72),
  'Cancellation re-offers',
  'How a freed shift spot is re-offered after a cancellation. A cancellation with more than this many hours'' notice waits for the next 3pm re-offer run; one with this much notice or less goes out immediately to all available cleaners.'
)
on conflict (key) do nothing;

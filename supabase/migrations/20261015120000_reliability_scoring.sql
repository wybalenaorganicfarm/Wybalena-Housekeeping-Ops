-- ============================================================================
-- Reliability scoring weight.
--
-- The cleaner directory shows an accept-rate %. Until now it was
--   accepted / (accepted + declined + cancelled)
-- which weighted a decline (said no to an offer up front) exactly the same as a
-- cancellation (accepted, then pulled out later). The venue wants a cancellation
-- to count more heavily, since pulling out after committing is the costlier
-- behaviour. The % becomes
--   accepted / (accepted + declined + cancel_weight * cancelled)
-- with cancel_weight = 2 by default (a cancellation counts twice as much against
-- the score as a decline). The three raw counts are always shown separately, so
-- this only affects the single headline %.
--
-- Editable from the Automation Schedule page like every other tunable knob.
-- Seeded here because app_settings has no INSERT RLS policy — rows must arrive
-- via migration.
-- ============================================================================

insert into public.app_settings (key, value, label, description)
values (
  'reliability_scoring',
  jsonb_build_object('cancel_weight', 2),
  'Reliability scoring',
  'How heavily a cancellation counts against a cleaner''s accept-rate % compared with a decline. A weight of 2 means a cancellation (pulled out after accepting) lowers the score twice as much as a decline (said no up front). The accepted / declined / cancelled counts are always shown separately regardless of this.'
)
on conflict (key) do nothing;

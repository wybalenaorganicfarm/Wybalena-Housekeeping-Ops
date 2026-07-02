-- ============================================================================
-- Add the Operations Manager role. This person (e.g. Ashleigh) has the same
-- access as Admin, but is the recipient of ALL system emails (shift
-- confirmations, reminders, wipeover, tier-3 urgent, cancellation follow-ups).
--
-- The enum value must be committed before any policy/data references it, so this
-- migration ONLY adds the value; access policies are updated in the next one.
-- ============================================================================
alter type user_role add value if not exists 'operations_manager';

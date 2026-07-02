-- ============================================================================
-- Add 'team_lead' to assignment_status.
-- ============================================================================
-- The team leader is auto-assigned to every shift (see the next migration) and
-- is NOT offered the shift like a cleaner — their assignment carries this status
-- so the UI and staffing math treat their slot as reserved-and-filled.
-- Kept in its own migration so the new enum value is committed before the trigger
-- migration uses it (Postgres forbids using a freshly-added enum value in the
-- same transaction).
-- ============================================================================

alter type assignment_status add value if not exists 'team_lead';

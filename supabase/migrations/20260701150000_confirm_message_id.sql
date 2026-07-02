-- ============================================================================
-- Store the decline-confirmation ("Are you sure?") message id separately from the
-- offer message id, so BOTH remain matchable. Without this, sending the decline
-- confirmation overwrote offer_message_id, and a later tap on the original offer
-- (e.g. Cancel) could no longer be resolved to its assignment.
-- ============================================================================
alter table public.shift_assignments
  add column if not exists confirm_message_id text;

comment on column public.shift_assignments.confirm_message_id is
  'WhatsApp message id of the decline-confirmation prompt; used alongside offer_message_id to map inbound replies back to the offer.';

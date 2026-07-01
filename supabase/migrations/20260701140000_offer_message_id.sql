-- ============================================================================
-- Track the WhatsApp message id of the last interactive message (offer or
-- decline-confirmation) sent for each assignment. The inbound webhook matches a
-- button tap / reply to the exact offer by the message it's replying to (quoted
-- id), so taps resolve correctly even when a cleaner has several open offers.
-- ============================================================================
alter table public.shift_assignments
  add column if not exists offer_message_id text;

comment on column public.shift_assignments.offer_message_id is
  'WhatsApp message id of the last interactive message sent for this assignment; used to map inbound replies back to the offer.';

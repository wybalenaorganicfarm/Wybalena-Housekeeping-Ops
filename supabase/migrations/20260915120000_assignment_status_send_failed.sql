-- ============================================================================
-- assignment_status: add 'send_failed'
-- ============================================================================
-- Bug this fixes (Karin Gisler, 9 October shift — offer received but not shown):
--
-- When an offer's WhatsApp send returned not-ok, the engine DELETED the freshly
-- created assignment row on the assumption "the send failed, so the cleaner never
-- got it — remove the phantom offer". But Whapi can DELIVER a message and still
-- return an error or time out (a false negative). In that case the cleaner
-- receives the offer on WhatsApp while the platform deletes her row, so she
-- appears nowhere — not in offered / accepted / declined. That is exactly Karin's
-- report: "did send her a shift offer message, but Supabase isn't displaying that
-- the offer was sent to her at all."
--
-- Fix: instead of deleting, mark the row 'send_failed' so it stays visible on the
-- shift, is clearly flagged as not confirmed-delivered, does not count toward
-- staffing (only 'accepted' does), and can be retried. See engine.ts deliverOffers
-- / offerToCleaner and ShiftDrawer's responder list.
-- ============================================================================

alter type assignment_status add value if not exists 'send_failed';

comment on type assignment_status is
  'offered | accepted | declined | cancelled | no_response | send_failed. send_failed = the offer row was created but the WhatsApp send returned not-ok (the cleaner MAY still have received it); kept visible and retryable rather than deleted.';

-- confirm_sent_at — when the "Are you sure?" prompt was last sent for an offer.
--
-- whatsapp-inbound needs to know WHICH prompt a Yes/No answer belongs to when the
-- tap arrives as a plain-text echo of the button title (no interactive payload)
-- and WhatsApp attaches no quoted-message context. Previously such an answer was
-- dropped whenever the cleaner had more than one open offer: the decline was
-- never recorded and the shift was chased again the next morning.
--
-- offered_at cannot stand in for this. It records when the OFFER was sent, so a
-- cleaner prompted on an older offer while a newer one is still open would have
-- their answer applied to the wrong shift. The prompt we sent most recently is
-- by definition the one being answered.
alter table public.shift_assignments
  add column if not exists confirm_sent_at timestamptz;

comment on column public.shift_assignments.confirm_sent_at is
  'When the decline/cancel confirmation prompt was last sent. Used to resolve a Yes/No answer to the right offer when the reply carries no button payload or quoted-message id.';

-- Backfill so rows already holding an outstanding prompt remain resolvable.
update public.shift_assignments
   set confirm_sent_at = coalesce(responded_at, offered_at)
 where confirm_message_id is not null
   and confirm_sent_at is null;

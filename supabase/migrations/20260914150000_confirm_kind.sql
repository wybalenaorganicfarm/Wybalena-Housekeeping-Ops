-- ============================================================================
-- confirm_kind — which prompt/confirmation was last sent for an offer
-- ============================================================================
-- Bug this fixes: a bare "Yes"/"No" answer that arrives as a plain-text echo (no
-- button payload, no quoted-message id) is resolved to the cleaner's most recent
-- row by confirm_sent_at. But confirm_sent_at is stamped by the accept confirmation
-- AND the decline prompt AND the cancel prompt — they all share the same columns.
-- So a "Yes cancel" meant for an accepted shift A could resolve to a different
-- shift B whose decline prompt happened to be stamped more recently — cancelling
-- the wrong shift.
--
-- confirm_kind records what the last prompt on the row actually was, so a
-- cancel_confirm answer only matches rows whose last prompt was a cancel prompt,
-- and a decline_confirm answer only matches rows whose last prompt was a decline
-- prompt. See whatsapp-inbound step (c2).
-- ============================================================================
alter table public.shift_assignments
  add column if not exists confirm_kind text
    check (confirm_kind in ('decline', 'cancel', 'accept'));

comment on column public.shift_assignments.confirm_kind is
  'Which prompt/confirmation was last sent (decline | cancel | accept). Disambiguates a plain-text Yes/No answer so it resolves to the right offer.';

-- Backfill existing outstanding prompts by current status: a row still awaiting a
-- decline answer is 'offered'; one awaiting a cancel answer is 'accepted'. Accept
-- confirmations aren't answered with Yes/No, so leave those null unless already set.
update public.shift_assignments
   set confirm_kind = case
         when status = 'accepted' then 'cancel'
         when status = 'offered'  then 'decline'
         else confirm_kind
       end
 where confirm_message_id is not null
   and confirm_kind is null;

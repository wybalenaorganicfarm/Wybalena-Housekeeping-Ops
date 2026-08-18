-- ============================================================================
-- Offer fallback message: ask for a keyword reply, not a button tap
-- ============================================================================
-- The shift_offer template's `fallback` is only ever sent when the interactive
-- Accept/Decline buttons could NOT be delivered — yet it read "Please open
-- WhatsApp and tap Accept or Decline on the offer", telling the cleaner to tap a
-- button that isn't there.
--
-- Live case: on 17 Aug at 3:01:04pm AEST Whapi rejected the interactive send for
-- the 24 September shift with `428 Internal Error / Connection Closed` — the
-- WhatsApp Web socket had dropped. The fallback text went out instead. Because
-- that cleaner had two open offers, whatsapp-inbound deliberately ignores a bare
-- typed "Accept" (it can't tell which shift is meant), so the offer was
-- unanswerable by any route the message described.
--
-- The new wording says plainly that the buttons failed and asks for
-- "ACCEPT <code>" / "DECLINE <code>". The code resolves the reply to the exact
-- offer via shift_assignments.offer_code — the one form that still works when a
-- cleaner is holding several offers at once.
--
-- {{offer_code}} is a new placeholder, populated by _shared/engine.ts. Unknown
-- placeholders render empty rather than throwing, so a template edit that drops
-- it still sends.
--
-- Three places to keep in step, or the old wording comes back:
--   fallback           — what is sent today
--   defaults->fallback — what "Reset to default" on /templates restores
--   variables          — the placeholder chips offered in the editor
-- See supabase/functions/_shared/engine.ts (sendOfferMessage).
-- ============================================================================

with new_text as (
  select
    'New cleaning shift on {{shift_date}} at {{start_time}}.' || chr(10) || chr(10) ||
    'The Accept/Decline buttons didn''t come through this time. ' ||
    'Please reply ACCEPT {{offer_code}} to take this shift, or DECLINE {{offer_code}} to pass.' as t
)
update public.message_templates m
set
  -- Leave a hand-edited fallback alone; only replace the wording we shipped.
  fallback = case
    when m.fallback is null or m.fallback = m.defaults ->> 'fallback' then n.t
    else m.fallback
  end,
  defaults = jsonb_set(m.defaults, '{fallback}', to_jsonb(n.t)),
  variables = case
    when m.variables @> '[{"name": "offer_code"}]'::jsonb then m.variables
    else coalesce(m.variables, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'name', 'offer_code',
        'description', 'Four-digit reply code, e.g. 4823 — only used in the plain-text fallback'
      )
    )
  end
from new_text n
where m.key = 'shift_offer';

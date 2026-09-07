-- Put the offer code where a stripped button tap can still be recognised.
-- ============================================================================
-- A cleaner declined one of two open shifts and the response was lost. The tap
-- reached us with no interactive payload and no quoted-message context, so
-- nothing in it said WHICH shift it answered; with more than one offer open the
-- webhook could not correlate it and dropped it silently. The next morning both
-- shifts were chased again as though she had never replied.
--
-- Every offer already has a unique 4-digit code (shift_assignments.offer_code),
-- but it only ever appeared in the plain-text FALLBACK — the message sent when
-- buttons fail. On a normal button offer the code was nowhere in the message, so
-- once the payload was stripped there was nothing left to match on.
--
-- Two changes, neither of which asks the cleaner to do anything differently:
--
--   1. The button TITLES now carry the code ("❌ Decline 0409"). WhatsApp echoes
--      the title as text when it strips the payload, so the code survives and
--      _shared/adapters/whatsapp.ts reads it straight back off the reply. The
--      titles here are what the Message Templates page shows; the code itself is
--      appended at send time by titleWithCode(), which drops it rather than
--      exceed WhatsApp's 20-character title limit.
--
--   2. The body shows the code too, so the cleaner and the admin can both see
--      which offer a message refers to when several are open — the date and time
--      already shown, now with an unambiguous reference.
--
-- {{offer_code}} was already a declared variable on this template (added by
-- 20260817140000_offer_fallback_wording.sql for the fallback), so it needs no
-- new registration — it simply appears in the body and buttons as well now.
-- ============================================================================

with new_body as (
  select
    E'*SHIFT DETAILS*\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}\n🔖 Ref: {{offer_code}}\n\nTap *Accept* to take this shift, or *Decline* to pass.' as b,
    '[{"id":"accept","title":"✅ Accept"},{"id":"decline","title":"❌ Decline"}]'::jsonb as btn
)
update public.message_templates m
set
  -- Leave a hand-edited body alone; only replace the wording we shipped.
  body = case
    when m.body is null or m.body = m.defaults ->> 'body' then n.b
    else m.body
  end,
  defaults = jsonb_set(m.defaults, '{body}', to_jsonb(n.b))
from new_body n
where m.key = 'shift_offer';

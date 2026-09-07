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
    E'*SHIFT DETAILS*\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}\n🔖 Ref: {{offer_code}}\n\nTap *Accept* to take this shift, or *Decline* to pass.' as b
)
update public.message_templates m
set
  -- Add the reference line without discarding a hand-edited body.
  --
  -- The first version of this migration only replaced the body when it still
  -- matched the shipped default, so on a CUSTOMISED template it changed nothing
  -- and the Ref line never appeared. That guard is right in spirit — a migration
  -- must not silently overwrite Ashleigh's wording — but it made the change a
  -- no-op exactly where it was needed.
  --
  -- So: if the body already mentions {{offer_code}}, leave it completely alone.
  -- Otherwise insert the Ref line directly after the Time line, preserving every
  -- other word. If no Time line is found (heavily reworded), append it instead so
  -- the reference is still present.
  body = case
    when m.body is null then n.b
    when position('{{offer_code}}' in m.body) > 0 then m.body
    -- LIKE + replace(), not regexp_replace with an E'' replacement string: in an
    -- E'' string  is parsed as octal 001, not a backreference, so the captured
    -- {{start_time}} would be destroyed instead of kept. chr(10) is an unambiguous
    -- newline in a standard string.
    when m.body like '%{{start_time}}%' then
      replace(m.body, '{{start_time}}', '{{start_time}}' || chr(10) || '🔖 Ref: {{offer_code}}')
    else m.body || chr(10) || chr(10) || '🔖 Ref: {{offer_code}}'
  end,
  -- The default always carries the Ref line, so 'Reset to default' restores it.
  defaults = jsonb_set(m.defaults, '{body}', to_jsonb(n.b)),
  -- Button titles stay '✅ Accept' / '❌ Decline' here. The code is appended at
  -- SEND time by titleWithCode() in _shared/adapters/whatsapp.ts: it differs per
  -- shift ('✅ Accept 0409'), and that function drops it rather than exceed
  -- WhatsApp's 20-character title limit. Storing a code here would freeze one
  -- shift's reference onto every future offer.
  --
  -- {{offer_code}} was already declared by 20260817140000_offer_fallback_wording
  -- .sql, but described as a random four-digit code used only in the plain-text
  -- fallback. It is now the shift date (DDMM) and appears in the body and buttons.
  variables = (
    select coalesce(jsonb_agg(
      case when v ->> 'name' = 'offer_code'
        then jsonb_build_object(
          'name', 'offer_code',
          'description', 'Shift reference shown in the message and on the buttons: the shift date as DDMM, e.g. 0409 for 4 September, or 0409-2 for a second shift the same day'
        )
        else v
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(coalesce(m.variables, '[]'::jsonb)) v
  )
from new_body n
where m.key = 'shift_offer';

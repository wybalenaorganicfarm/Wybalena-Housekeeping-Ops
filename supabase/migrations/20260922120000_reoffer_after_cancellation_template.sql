-- ============================================================================
-- New template: reoffer_after_cancellation
-- ============================================================================
-- When a cleaner cancels a shift whose tier chain is already exhausted, the
-- engine re-asks EVERY offerable cleaner who is not on the shift — including
-- people who declined it weeks ago (reofferToUnaccepted in _shared/engine.ts).
--
-- Until now that went out on the standard `shift_offer` template, so a cleaner
-- who had already declined received a message identical to the original offer
-- and had no way to tell why it was back. Ashleigh asked for distinct wording:
-- "someone has cancelled, a new spot has opened up", so the team understands
-- they are being asked again because a place came free — not because the system
-- is repeating itself.
--
-- Same variables and the same Accept/Decline buttons as `shift_offer`, so the
-- send path, the offer code and the reply handling are all unchanged. Only the
-- wording differs. Button titles stay plain here: the code is appended at send
-- time by titleWithCode(), which drops it rather than exceed WhatsApp's
-- 20-character title limit (see 20260902130000_offer_code_in_buttons.sql).
--
-- Editable on the Templates page like every other row — that page renders
-- whatever is in this table, grouped by `category` and ordered by `sort_order`,
-- so seeding the row is all that is needed for it to appear. sort_order 2 puts
-- it directly under 'Shift offer' in the 'Offer & acceptance' group.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'reoffer_after_cancellation',
    'Offer & acceptance',
    'A spot has opened up (after a cancellation)',
    'Sent instead of the standard shift offer when a cleaner cancels and the shift is re-offered to everyone still available. Explains why a cleaner who already declined is being asked again.',
    E'*A SPOT HAS OPENED UP* 🔄\n\nSomeone has cancelled, so this shift is available again.\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}\n🔖 Ref: {{offer_code}}\n\nYou may have seen this shift before — we''re asking everyone again now a place has come free.\n\nTap *Accept* to take it, or *Decline* to pass.',
    '🔄 A Spot Has Opened Up',
    'Wybalena Organic Farm',
    E'A spot has opened up on the cleaning shift on {{shift_date}} at {{start_time}} — someone has cancelled.\n\nThe Accept/Decline buttons didn''t come through this time. Please reply ACCEPT {{offer_code}} to take this shift, or DECLINE {{offer_code}} to pass.',
    '[{"id":"accept","title":"✅ Accept"},{"id":"decline","title":"❌ Decline"}]'::jsonb,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 4th October 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"},{"name":"offer_code","description":"Shift reference shown in the message and on the buttons: the shift date as DDMM, e.g. 0410 for 4 October, or 0410-2 for a second shift the same day"}]'::jsonb,
    2
  )
on conflict (key) do nothing;

-- Snapshot the seeded text so 'Reset to default' works on this row like the
-- others. Written from the row itself rather than repeating the literals, so the
-- two can never drift apart.
update public.message_templates
set defaults = jsonb_build_object(
      'body',     body,
      'header',   header,
      'footer',   footer,
      'fallback', fallback,
      'buttons',  buttons
    )
where key = 'reoffer_after_cancellation'
  and (defaults is null or defaults = '{}'::jsonb);

-- The existing 'shift_full' row also sits in 'Offer & acceptance' at sort_order
-- 3, so nothing collides. Kept explicit in case that changes.
update public.message_templates set sort_order = 3 where key = 'shift_full';

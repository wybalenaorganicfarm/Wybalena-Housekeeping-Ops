-- ============================================================================
-- Template: reply_shift_already_filled
--
-- Sent when a cleaner taps "No, keep me on this shift" on a cancel prompt, but her
-- assignment is no longer active AND the shift has since been FILLED by someone
-- else. Previously the "keep me on" reply always said "you're still on this shift"
-- without checking — so a stale cancel prompt (Denny, 22 Oct) told a cleaner she
-- was rostered when she had already cancelled and the spot was re-offered and
-- filled. whatsapp-inbound now verifies her real state and sends this instead.
--
-- When she is simply not on the shift (but it is not full) the existing
-- reply_not_on_shift is used. Same fallback contract: the function carries an
-- inline default, so a missing row can never stop the message being sent — this
-- row just makes the wording editable on the Message Templates page.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'reply_shift_already_filled',
    'Replies & edge cases',
    'Shift already filled',
    'Sent when a cleaner taps "No, keep me on" on a cancel prompt but she is no longer on the shift and it has already been filled by someone else.',
    E'That shift has already been filled by someone else, so you''re not on it. Nothing has changed.',
    null, null, null, null, '[]'::jsonb,
    28
  )
on conflict (key) do nothing;

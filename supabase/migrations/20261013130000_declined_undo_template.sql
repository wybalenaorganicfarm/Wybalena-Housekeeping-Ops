-- ============================================================================
-- Template: declined_undo
--
-- The one-tap decline outcome. The decline flow was simplified (Oct 2026) from a
-- two-step confirm ("Decline" → "are you sure?" Yes/No) to a single tap that
-- declines immediately and shows this message with an *Accept offer* button to undo
-- a mis-tap. Replaces the need to confirm every decline when clearing several
-- offers. The button reuses the normal accept payload, so tapping it re-takes the
-- shift (the claim RPC now allows a just-declined row).
--
-- Variables: {{shift_date}}, {{start_time}}.
-- The "accept" button title is editable via the buttons array.
--
-- Same fallback contract as every template: the function carries an inline default,
-- so a missing row can never stop the message. This row makes it editable on the
-- Message Templates page. The old decline_prompt / declined_confirmation templates
-- are left in place (older in-flight messages on cleaners' phones may still use the
-- two-step buttons, which the webhook still handles).
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'declined_undo',
    'Confirmations',
    'Shift declined (with undo)',
    'Sent the moment a cleaner taps Decline. Confirms the decline and offers a single Accept button to undo a mis-tap — no more "are you sure?" step.',
    E'Shift Declined ❌\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}\n\nTapped by mistake? Tap *Accept offer* to undo.',
    null,
    'Wybalena Organic Farm',
    null,
    '[{"id":"accept","title":"↩️ Accept offer"}]'::jsonb,
    '["shift_date","start_time"]'::jsonb,
    14
  )
on conflict (key) do nothing;

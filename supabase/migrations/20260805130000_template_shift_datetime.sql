-- ============================================================================
-- Message templates — every cleaner reply names the shift's date & time
-- ============================================================================
-- The accept / decline / cancel replies said only "Shift Accepted ✅" with no
-- shift attached, which is ambiguous for a cleaner holding several offers. Each
-- of those bodies now carries {{shift_date}} and {{start_time}}, and the two
-- outcome replies ("Shift Cancelled" / "Shift Declined") — previously hardcoded
-- strings in whatsapp-inbound — become editable rows like the rest.
--
-- Values substituted at send time come from prettyDate/prettyTime, so
-- {{shift_date}} renders "Sunday 23rd August 2026" and {{start_time}} renders
-- "10:00am". The `variables` descriptions are corrected to match — they had
-- advertised the raw ISO forms.
-- ============================================================================

-- Only rewrite bodies that are still the seeded default: an admin who has
-- already reworded a message keeps their wording (they can add the placeholders
-- themselves, or use Reset to default to pick up the new copy).
update public.message_templates
set body = E'Shift Accepted ✅\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}',
    variables = '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb
where key = 'accept_confirmation' and body = defaults->>'body';

update public.message_templates
set body = E'Are you sure you want to decline the shift on {{shift_date}} at {{start_time}}?',
    variables = '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb
where key = 'decline_prompt' and body = defaults->>'body';

update public.message_templates
set body = E'Are you sure you want to cancel the shift on {{shift_date}} at {{start_time}}?',
    variables = '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb
where key = 'cancel_prompt' and body = defaults->>'body';

-- Correct the misleading ISO examples on the templates that already carried the
-- placeholders (the two reminders and the offer). Bodies are untouched.
update public.message_templates
set variables = '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb
where key = 'shift_offer';

update public.message_templates
set variables = '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"}]'::jsonb
where key = 'reminder_nonresponder';

update public.message_templates
set variables = '[{"name":"shift_type","description":"Shift type, e.g. standard"},{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb
where key = 'reminder_preshift';

-- The two outcome replies, newly editable.
insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'declined_confirmation',
    'Confirmations',
    'Declined — confirmation',
    'Sent after a cleaner taps Yes on the decline prompt. Confirms which shift they passed on.',
    E'Shift Declined\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}',
    null,
    null,
    null,
    null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    7
  ),
  (
    'cancelled_confirmation',
    'Confirmations',
    'Cancelled — confirmation',
    'Sent after a cleaner taps Yes on the cancel prompt. Confirms which shift they dropped.',
    E'Shift Cancelled\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}',
    null,
    null,
    null,
    null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    8
  )
on conflict (key) do nothing;

-- Re-snapshot defaults for every row this migration rewrote, so "Reset to
-- default" restores the new copy rather than the old placeholder-less text.
update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
)
where key in (
  'accept_confirmation', 'decline_prompt', 'cancel_prompt',
  'declined_confirmation', 'cancelled_confirmation'
);

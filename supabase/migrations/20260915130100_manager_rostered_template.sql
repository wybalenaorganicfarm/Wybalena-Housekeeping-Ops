-- ============================================================================
-- Cleaning Manager "you've been rostered" NOTIFICATION template.
--
-- Sent by notify-manager-roster via sendMessage (plain text) — NOT an offer.
-- No buttons, no Accept, no staffing effect. The "No action needed" line is
-- load-bearing: it tells the manager this is a confirmation, so she doesn't wait
-- for an Accept button the way she would for a tier offer. Keep that distinction
-- if the copy is reworded from the Message Templates page.
--
-- {{shift_type}} renders whatever the CALLER passes. notify-manager-roster maps
-- it through the server-side prettyType helper first (and formats shift_date /
-- start_time the same way the other roster messages do), so she reads
-- "Standard clean on Sunday 23rd August 2026 at 10:00am", never a raw enum or ISO.
--
-- Same contract as every other template: the Edge Function has a built-in
-- fallback, so a missing/edited row can never stop the message being sent.
-- Category "Roster & onboarding" (sort 40-49) — the team-lead/roster group.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'manager_rostered',
    'Roster & onboarding',
    'Cleaning Manager — rostered onto a shift',
    'Sent to the Cleaning Manager when she is auto-rostered onto a (non-wipeover) shift. A notification, not an offer — she is on the shift with no action required.',
    E'You''ve been rostered onto the {{shift_type}} clean on {{shift_date}} at {{start_time}}. No action needed — this is your confirmation.',
    null,
    'Wybalena Organic Farm',
    null,
    null,
    '[{"name":"shift_type","description":"Clean type, e.g. Standard"},{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    42
  )
on conflict (key) do nothing;

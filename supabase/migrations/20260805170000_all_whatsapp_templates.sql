-- ============================================================================
-- Every cleaner-facing WhatsApp message becomes editable
-- ============================================================================
-- Only the six "main" messages were in message_templates; the rest were string
-- literals in the Edge Functions, so rewording them meant a code change and a
-- redeploy. This adds the remaining ones and regroups the whole set so the
-- Message Templates page reads in the order a cleaner actually experiences them.
--
-- Categories (and sort_order ranges):
--    1-9   Offer & acceptance    — the offer and what follows an Accept
--   10-19  Confirmations         — the "are you sure?" prompts and their outcomes
--   20-29  Replies & edge cases  — automatic answers to a tap that can't apply
--   30-39  Reminders             — the scheduled nudges
--   40-49  Roster & onboarding   — team-lead roster, welcome message
--   50-59  Staff notifications   — messages to the ops manager / admins, not cleaners
--
-- Same contract as before: Edge Functions read these with a built-in fallback,
-- so a missing row can never stop a message being sent.
-- ============================================================================

-- Regroup / renumber the existing rows -----------------------------------
update public.message_templates set category = 'Offer & acceptance',   sort_order = 1  where key = 'shift_offer';
update public.message_templates set category = 'Offer & acceptance',   sort_order = 2  where key = 'accept_confirmation';
update public.message_templates set category = 'Confirmations',        sort_order = 10 where key = 'decline_prompt';
update public.message_templates set category = 'Confirmations',        sort_order = 11 where key = 'declined_confirmation';
update public.message_templates set category = 'Confirmations',        sort_order = 12 where key = 'cancel_prompt';
update public.message_templates set category = 'Confirmations',        sort_order = 13 where key = 'cancelled_confirmation';
update public.message_templates set category = 'Reminders',            sort_order = 30 where key = 'reminder_nonresponder';
update public.message_templates set category = 'Reminders',            sort_order = 31 where key = 'reminder_preshift';

-- The messages that were hardcoded in the Edge Functions -------------------
insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  -- ── Offer & acceptance ──────────────────────────────────────────────────
  (
    'shift_full',
    'Offer & acceptance',
    'Shift is now fully booked',
    'Sent to cleaners still holding an open offer when the shift fills up. Their offer is closed at the same time.',
    E'That shift on {{shift_date}} at {{start_time}} is now fully booked. Thanks!',
    null, null, null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    3
  ),

  -- ── Replies & edge cases ────────────────────────────────────────────────
  (
    'reply_shift_just_filled',
    'Replies & edge cases',
    'Accepted — but the shift just filled',
    'Sent when a cleaner taps Accept a moment after the last spot was taken.',
    E'Sorry, the shift on {{shift_date}} at {{start_time}} just filled up and is now fully staffed. Thanks for responding!',
    null, null, null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    20
  ),
  (
    'reply_offer_closed',
    'Replies & edge cases',
    'Offer is no longer open',
    'Sent when a cleaner replies to an offer that has since been withdrawn or expired.',
    E'Sorry, the shift offer for {{shift_date}} at {{start_time}} is no longer open.',
    null, null, null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    21
  ),
  (
    'reply_already_accepted',
    'Replies & edge cases',
    'Already accepted — cannot decline',
    'Sent when a cleaner taps Decline on a shift they have already accepted. Points them at the Cancel button instead.',
    E'You''ve already accepted the shift on {{shift_date}} at {{start_time}}. If you can''t make it, tap the *Cancel* button on your confirmation message.',
    null, null, null, null,
    '[{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"}]'::jsonb,
    22
  ),
  (
    'reply_already_declined',
    'Replies & edge cases',
    'Already declined',
    'Sent when a cleaner taps Decline a second time on the same offer.',
    E'You''ve already declined this shift. No further action needed.',
    null, null, null, null, '[]'::jsonb,
    23
  ),
  (
    'reply_declined_nothing_to_cancel',
    'Replies & edge cases',
    'Declined — nothing to cancel',
    'Sent when a cleaner taps Cancel on a shift they had already declined.',
    E'You''ve already declined this shift, so there''s nothing to cancel.',
    null, null, null, null, '[]'::jsonb,
    24
  ),
  (
    'reply_not_on_shift',
    'Replies & edge cases',
    'Not on this shift',
    'Sent when a cleaner taps Cancel but is no longer on the shift (already cancelled, or the offer lapsed).',
    E'You''re not currently on this shift, so there''s nothing to cancel.',
    null, null, null, null, '[]'::jsonb,
    25
  ),
  (
    'reply_decline_kept',
    'Replies & edge cases',
    'Decline cancelled — offer kept',
    'Sent when a cleaner taps "No, keep offer" on the decline prompt.',
    E'Not declined, please select accept above.',
    null, null, null, null, '[]'::jsonb,
    26
  ),
  (
    'reply_cancel_kept',
    'Replies & edge cases',
    'Cancel cancelled — shift kept',
    'Sent when a cleaner taps "No, keep shift" on the cancel prompt.',
    E'No problem — nothing was cancelled. You''re still on this shift.',
    null, null, null, null, '[]'::jsonb,
    27
  ),
  (
    'shift_cancelled_by_admin',
    'Replies & edge cases',
    'Shift cancelled by the office',
    'Sent to every cleaner who had accepted a shift that the office then cancelled.',
    E'A shift you accepted has been cancelled. No action needed.',
    null, null, null, null, '[]'::jsonb,
    28
  ),

  -- ── Roster & onboarding ─────────────────────────────────────────────────
  (
    'lead_roster',
    'Roster & onboarding',
    'Team lead — tomorrow''s roster',
    'Sent to the team lead the day before, summarising every shift and who is confirmed. {{shift_blocks}} is the generated per-shift list.',
    E'*Tomorrow''s Roster* 📋\n\n{{shift_blocks}}\n\n_Total: {{total_cleaners}} cleaner(s) across {{total_shifts}} shift(s)._',
    null, null, null, null,
    '[{"name":"shift_blocks","description":"Generated block per shift: date, time, type and confirmed cleaners"},{"name":"total_cleaners","description":"Total confirmed cleaners across all shifts"},{"name":"total_shifts","description":"Number of shifts tomorrow"}]'::jsonb,
    40
  ),
  (
    'cleaner_welcome',
    'Roster & onboarding',
    'Welcome — new cleaner added',
    'Sent once when a cleaner is added to the roster from the Cleaners page.',
    E'Hi {{cleaner_name}}! You''ve been added to the Wybalena cleaning roster. You''ll get shift offers here on WhatsApp — reply YES to accept or NO to decline. Welcome aboard! 🧹',
    null, null, null, null,
    '[{"name":"cleaner_name","description":"The cleaner''s full name"}]'::jsonb,
    41
  ),

  -- ── Staff notifications (ops manager / admins, not cleaners) ────────────
  (
    'mid_retreat_whatsapp',
    'Staff notifications',
    'Ops manager — mid-retreat clean needed',
    'WhatsApp to the Operations Manager when long stays (7+ nights) need a mid-retreat clean scheduled by hand. {{booking_list}} is the generated list of those bookings.',
    E'🧹 *Mid-Retreat Clean(s) Required*\n\n{{booking_list}}\n\nThese shifts are not created automatically — please add them from the Shifts page.',
    null, null, null, null,
    '[{"name":"booking_list","description":"Generated list: guest, nights, stay dates and suggested mid-stay date"},{"name":"count","description":"How many bookings need a mid-retreat clean"}]'::jsonb,
    50
  ),
  (
    'connection_alert_whatsapp',
    'Staff notifications',
    'Admins — connection failure alert',
    'WhatsApp to all admins when integrations are down AND the email alert could not be sent. The fallback channel, so it only fires when email is unavailable.',
    E'⚠️ *Wybalena system alert*\n\n{{count}} connection(s) are not working: {{connections}}.\n\nEmail alerts couldn''t be sent, so you''re getting this on WhatsApp. Please open the app to review.',
    null, null, null, null,
    '[{"name":"count","description":"How many connections are failing"},{"name":"connections","description":"Names of the failing connections, e.g. Gmail, WhatsApp"}]'::jsonb,
    51
  )
  -- 'lead_cleaner_cancelled' (sort_order 52) is seeded by
  -- 20260805180000_lead_cancellation_template.sql — it was added after this
  -- migration had already been applied, so it needed its own file.
on conflict (key) do nothing;

-- Snapshot defaults for the new rows so "Reset to default" works on them too.
update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
)
where defaults = '{}'::jsonb or defaults is null;

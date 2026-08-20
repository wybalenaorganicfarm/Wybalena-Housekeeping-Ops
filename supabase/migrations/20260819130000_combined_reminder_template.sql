-- ============================================================================
-- SUPERSEDED by 20260820140000_reminder_wording.sql — kept as history
-- ============================================================================
-- This migration is already applied in production, so it must stay in the repo:
-- deleting an applied migration leaves the local directory out of step with the
-- remote history table and blocks `supabase db push`.
--
-- It added a second reminder template holding a combined message that LISTED
-- each outstanding shift date. That was the wrong shape: accepting and declining
-- is done on the buttons of the original offer message, so the reminder only
-- needs to point the cleaner back at those offers — no dates, no offer codes, no
-- buttons of its own. 20260820140000 rewrites the single `reminder_nonresponder`
-- template to that plain wording and DELETES the row this file inserts.
--
-- Nothing references `reminder_nonresponder_multi` any more. Do not reintroduce
-- it; change the wording on `reminder_nonresponder` instead, which is editable
-- from /templates.
--
-- The original statement is preserved below, unchanged, purely so the applied
-- history is readable. It is a no-op on a database that already ran it.
-- ============================================================================

insert into public.message_templates (key, category, label, description, body, variables, defaults, sort_order)
values (
  'reminder_nonresponder_multi',
  'Reminders',
  'Reminder — no reply to several offers',
  'Sent instead of separate reminders when one cleaner has more than one unanswered offer in the same run. Keeps a busy cleaner from receiving a burst of near-identical messages.',
  'Reminder: you have {{count}} cleaning shift offers still waiting for your reply:' || chr(10) || chr(10) ||
    '{{shift_dates}}' || chr(10) || chr(10) ||
    'Please Accept or Decline each one on the original offer message.',
  jsonb_build_array(
    jsonb_build_object('name', 'count', 'description', 'How many offers are unanswered, e.g. 5'),
    jsonb_build_object('name', 'shift_dates', 'description', 'The shift dates, one per line, already bulleted')
  ),
  jsonb_build_object(
    'body',
    'Reminder: you have {{count}} cleaning shift offers still waiting for your reply:' || chr(10) || chr(10) ||
      '{{shift_dates}}' || chr(10) || chr(10) ||
      'Please Accept or Decline each one on the original offer message.'
  ),
  30
)
on conflict (key) do nothing;

-- ============================================================================
-- Non-responder reminder wording: name the shift, no codes, no buttons
-- ============================================================================
-- Two things were wrong with the reminders the client received:
--
--   1. They were sent once PER UNANSWERED OFFER. A cleaner holding several open
--      offers got several near-identical messages seconds apart — five to one
--      Tier 3 cleaner on 19 August. Fixed in _shared/remindTier.ts: ONE message
--      per cleaner per run, however many offers they owe a reply on.
--
--   2. The wording. It is now stated plainly, and it NAMES THE SHIFT so the
--      cleaner knows which offer is being chased.
--
-- Two templates, because the singular and plural forms cannot be one sentence
-- that reads well:
--
--   reminder_nonresponder        — the cleaner owes a reply on ONE offer.
--                                  {{shift_date}} is that shift's date.
--   reminder_nonresponder_multi  — they owe a reply on SEVERAL. {{shift_dates}}
--                                  is the list, one bulleted line per shift,
--                                  soonest first. Only the offers they have not
--                                  answered appear — anything accepted,
--                                  declined or closed is excluded upstream.
--
-- Deliberately NOT in either message:
--   • No offer code. Accepting and declining is by the buttons on the original
--     offer message only; the "reply ACCEPT 4823" route is not the method in
--     use, so quoting a code here would just confuse.
--   • No buttons of its own. The buttons that matter are on the original offer,
--     which is exactly where this points the cleaner.
--
-- Three places to keep in step per template, or the old wording comes back:
--   body           — what is sent today
--   defaults->body — what "Reset to default" on /templates restores
--   variables      — the placeholder chips offered in the editor
-- See supabase/functions/_shared/remindTier.ts (sendReminders).
--
-- NOTE ON NUMBERING: this supersedes 20260819130000, which is already applied
-- and therefore cannot be edited — a replacement written at that same version
-- would be silently skipped by `db push`. That file stays in the repo as history
-- (deleting an applied migration puts local and remote out of step); the row it
-- inserted is reworded below rather than dropped.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Singular: one unanswered offer
-- ---------------------------------------------------------------------------
-- Replaces the body UNCONDITIONALLY, including the hand-edited wording that was
-- live until now:
--   "Reminder: Please respond to the cleaning shift offer for {{shift_date}}.
--    Tap Accept or Decline on the message."
-- Recorded here so it can be restored by hand from /templates if ever wanted.
with new_text as (
  select 'Please respond to the shift offer we have sent you for the {{shift_date}} cleaning shift.' as t
)
update public.message_templates m
set
  body = n.t,
  defaults = jsonb_set(m.defaults, '{body}', to_jsonb(n.t)),
  variables = jsonb_build_array(
    jsonb_build_object('name', 'shift_date', 'description', 'Shift date, e.g. Sunday 23rd August 2026')
  ),
  description = 'Sent when a cleaner has not replied to a single shift offer. If they have more than one outstanding, the combined version below is sent instead — never both, and never one message per offer.'
from new_text n
where m.key = 'reminder_nonresponder';

-- ---------------------------------------------------------------------------
-- Plural: several unanswered offers, in ONE message
-- ---------------------------------------------------------------------------
with new_text as (
  select 'Please respond to the shift offers we have sent you for these cleaning shifts:' || chr(10) || chr(10) ||
         '{{shift_dates}}' as t
)
update public.message_templates m
set
  body = n.t,
  defaults = jsonb_set(m.defaults, '{body}', to_jsonb(n.t)),
  variables = jsonb_build_array(
    jsonb_build_object('name', 'shift_dates', 'description', 'The unanswered shift dates, one bulleted line each, soonest first')
  ),
  label = 'Reminder — no reply to several offers',
  description = 'Sent instead of separate reminders when one cleaner has more than one unanswered offer in the same run. This is what stops a cleaner receiving a burst of near-identical reminders.'
from new_text n
where m.key = 'reminder_nonresponder_multi';

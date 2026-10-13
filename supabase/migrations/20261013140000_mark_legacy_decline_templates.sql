-- ============================================================================
-- Mark the old two-step-decline templates as LEGACY on the Message Templates page.
--
-- The decline flow is now one tap + an undo button (declined_undo, see
-- 20261013130000). These three templates belonged to the old "Decline → are you
-- sure? Yes/No" flow and are no longer sent to anyone starting a decline now. They
-- are KEPT (not deleted) only so that a confirmation prompt already sitting on a
-- cleaner's phone from before the change still renders if tapped. Their wording no
-- longer affects the normal flow.
--
-- We relabel them (and prefix the description) so an admin reading the Message
-- Templates page can tell at a glance which decline message is actually live — the
-- new 'declined_undo' — and that editing these three changes nothing going forward.
-- Only label + description change; the message bodies are left untouched so the
-- legacy prompts still read correctly for any in-flight message.
-- ============================================================================

update public.message_templates
set label = 'Decline — are you sure? (legacy, no longer used)',
    description = 'LEGACY — the old two-step decline confirmation. The decline flow is now one tap with an undo button ("Shift declined (with undo)"), so this is no longer sent. Kept only for prompts already on a cleaner''s phone before the change.'
where key = 'decline_prompt';

update public.message_templates
set label = 'Shift declined — old (legacy, no longer used)',
    description = 'LEGACY — the old "Shift Declined" confirmation that followed the two-step decline. Replaced by "Shift declined (with undo)". No longer sent for new declines; kept for in-flight prompts only.'
where key = 'declined_confirmation';

update public.message_templates
set label = 'Decline kept — offer kept (legacy, no longer used)',
    description = 'LEGACY — sent when a cleaner tapped "No, keep offer" on the old decline prompt. The decline flow no longer has that step. Kept only for in-flight prompts.'
where key = 'reply_decline_kept';

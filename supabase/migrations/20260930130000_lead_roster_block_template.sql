-- ============================================================================
-- Template: lead_roster_block  (one shift's block in Zara's "Tomorrow's Roster")
--
-- Until now each per-shift block in the roster message was built entirely in code
-- (managerSummary.ts) and injected into the lead_roster template as an opaque
-- {{shift_blocks}} token. So the venue could edit the wording AROUND the list but
-- not the block itself — the date/time layout, the broom/clipboard emojis, and the
-- spacing were all locked in code. buildRosterBlocks() now renders each block
-- through THIS template, making that layout editable on the Message Templates page.
--
-- Variables available to the block:
--   {{shift_date}}     e.g. "Wednesday 30th September 2026"
--   {{start_time}}     e.g. "10:00am"
--   {{shift_type}}     e.g. "Deep Full Venue"
--   {{cleaner_count}}  number of confirmed cleaners
--   {{cleaner_list}}   the pre-formatted bullet list (or the "no cleaners" line)
--   {{cleaner_block}}  the whole cleaners section ready to drop in — the
--                      "N confirmed:" header + list, or just the warning when the
--                      shift has nobody. Use this to avoid handling the empty case.
--
-- SEED LAYOUT reflects the venue's requested changes (30 Sep 2026): time on its own
-- line under the date, no broom/clipboard emojis, and a blank line before the
-- cleaners. Editable from here on. Same fallback contract as every other template:
-- if this row is deleted, managerSummary.ts falls back to its built-in block, so
-- the message can never fail to send.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'lead_roster_block',
    'Roster & onboarding',
    'Roster — one shift block',
    'One shift''s block inside the Cleaning Manager''s "Tomorrow''s Roster" message. Controls how each shift''s date, time, type and confirmed cleaners are laid out. Variables: {{shift_date}}, {{start_time}}, {{shift_type}}, {{cleaner_count}}, {{cleaner_list}}.',
    E'{{shift_date}}\n{{start_time}} · {{shift_type}}\n\n{{cleaner_block}}',
    null, null, null, null,
    '["shift_date","start_time","shift_type","cleaner_count","cleaner_list"]'::jsonb,
    41
  )
on conflict (key) do nothing;

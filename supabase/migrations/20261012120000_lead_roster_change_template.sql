-- ============================================================================
-- Template: lead_roster_change
--
-- A short note to the Cleaning Manager when a shift's roster changes inside the
-- final 24 hours — a cleaner drops off, or a late acceptance / manual add fills a
-- spot. It carries a link that opens the shift, so she can act over a weekend
-- without waiting for the day-before roster summary. Gated by the
-- leadRosterChange24h notification switch (Schedule page) and the 24h window in
-- managerSummary.ts.
--
-- Variables:
--   {{cleaner_name}}  who joined or dropped off
--   {{change}}        "has dropped off" / "has joined"
--   {{shift_type}}    e.g. "Standard Clean"
--   {{shift_date}}    e.g. "Wednesday 30th September 2026"
--   {{start_time}}    e.g. "10:00am"
--   {{remaining}}     cleaners now confirmed
--   {{required}}      cleaners the shift needs
--   {{shift_link}}    URL that opens the shift on the dashboard
--
-- Same fallback contract as every template: the function carries an inline default,
-- so a missing row can never stop the message — this row just makes it editable on
-- the Message Templates page.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'lead_roster_change',
    'Roster & onboarding',
    'Roster change (final 24h)',
    'Sent to the Cleaning Manager when a cleaner drops off or joins a shift within the final 24 hours. Includes a link to open the shift.',
    E'🔄 *Roster update — tomorrow''s shift*\n\n{{cleaner_name}} {{change}} the {{shift_type}} · {{shift_date}} at {{start_time}} shift (now {{remaining}}/{{required}}).\n\nView the shift: {{shift_link}}',
    null, null, null, null,
    '["cleaner_name","change","shift_type","shift_date","start_time","remaining","required","shift_link"]'::jsonb,
    42
  )
on conflict (key) do nothing;

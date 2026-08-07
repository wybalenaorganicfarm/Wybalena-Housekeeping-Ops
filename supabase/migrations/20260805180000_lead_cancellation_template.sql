-- ============================================================================
-- Team lead notification: a cleaner cancelled
-- ============================================================================
-- Split into its own migration because 20260805170000 had already been applied
-- by the time this template was added — an applied migration is never re-run,
-- so the row would never have reached the database.
--
-- Sent by whatsapp-inbound the moment a cleaner confirms a cancellation. The
-- team lead runs the shift, so they're told immediately rather than finding out
-- from the next day's roster summary. Falls back to the built-in copy in
-- _shared/managerSummary.ts if this row is ever deleted.
-- ============================================================================

insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values (
  'lead_cleaner_cancelled',
  'Staff notifications',
  'Team lead — a cleaner cancelled',
  'WhatsApp to the team lead the moment a cleaner drops off one of their shifts, so the roster change is known before the next day''s summary.',
  E'⚠️ *Cleaner cancelled*\n\n{{cleaner_name}} has cancelled their spot.\n📅 {{shift_type}} · {{shift_date}} at {{start_time}}\n👥 Now {{remaining}}/{{required}} confirmed.\n\nThe office has been alerted and re-assignment is in progress.',
  null, null, null, null,
  '[{"name":"cleaner_name","description":"The cleaner who cancelled"},{"name":"shift_date","description":"Shift date, e.g. Sunday 23rd August 2026"},{"name":"start_time","description":"Start time, e.g. 10:00am"},{"name":"shift_type","description":"Clean type, e.g. Standard"},{"name":"remaining","description":"Cleaners still confirmed on the shift"},{"name":"required","description":"Cleaners the shift needs"}]'::jsonb,
  52
)
on conflict (key) do nothing;

-- Snapshot the seeded copy so "Reset to default" works on this row too.
update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
)
where key = 'lead_cleaner_cancelled'
  and (defaults = '{}'::jsonb or defaults is null);

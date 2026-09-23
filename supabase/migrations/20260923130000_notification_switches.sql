-- ============================================================================
-- Event-driven notification switches.
--
-- The Automation Schedule page lists CRON jobs, so any behaviour that fires on
-- an EVENT rather than a clock had no home there and could not be turned off
-- from the app at all. The venue's standing requirement is that everything the
-- system does is visible and editable by them, so those behaviours get an
-- explicit on/off here and a toggle on the Schedule page.
--
-- First switch: lead_cleaner_cancelled — the WhatsApp sent to the Cleaning
-- Manager when a cleaner cancels (template `lead_cleaner_cancelled`, sent from
-- whatsapp-inbound via notifyLeadCancellation). It is triggered by the cleaner's
-- reply, so it has no schedule.
--
-- Seeded TRUE: the notification existed before this setting did, so the default
-- must reproduce current behaviour. loadNotificationSwitches() also treats any
-- missing or malformed value as ON — a silent miss is worse than an extra
-- message here.
--
-- ⚠ THE SEED IS NOT OPTIONAL. app_settings has RLS policies for SELECT and
-- UPDATE only — there is deliberately NO INSERT policy, so no signed-in user can
-- create a settings row from the app, whatever their role. If this row is
-- missing, the Schedule page's toggle fails with "You don't have permission to
-- do that", because saving falls back to an INSERT that RLS refuses. Seeding it
-- here (as the migration runs with elevated rights) means the app only ever has
-- to UPDATE, which its policy allows. The other three settings rows exist for
-- the same reason.
-- ============================================================================

-- label and description are NOT NULL on this table (they are what the settings
-- UI reads), so both must be supplied — an insert of key+value alone is rejected.
insert into public.app_settings (key, value, label, description)
values (
  'notification_switches',
  jsonb_build_object('lead_cleaner_cancelled', true),
  'Event notifications',
  'Messages that fire on an event rather than on a schedule, so they have no time to set — only on or off. Covers the WhatsApp sent to the Cleaning Manager the moment a cleaner cancels a shift.'
)
on conflict (key) do nothing;

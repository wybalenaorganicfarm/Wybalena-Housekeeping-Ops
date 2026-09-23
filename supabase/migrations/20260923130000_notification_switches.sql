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
-- ============================================================================

insert into public.app_settings (key, value)
values ('notification_switches', jsonb_build_object('lead_cleaner_cancelled', true))
on conflict (key) do nothing;

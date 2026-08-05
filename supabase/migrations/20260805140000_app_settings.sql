-- ============================================================================
-- App settings — admin-editable operational knobs
-- ============================================================================
-- Values that an Admin / Operations Manager tunes from the app rather than by
-- redeploying an Edge Function. Same pattern as message_templates: Edge
-- Functions READ via the service-role key and fall back to their built-in
-- default when a row is missing, so a run can never fail because a setting was
-- deleted or the table isn't migrated yet.
--
-- First use: the Weekly Booking Sync date range. It was hardcoded as "run day
-- + 35 days, for 7 days" in sync-bookings; those two numbers now live here so
-- the range is visible and editable under Administration → Schedule.
-- ============================================================================

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  label       text not null,           -- human title for the UI
  description text not null,           -- what the setting controls
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.app_settings is
  'Admin-editable operational settings. Read by Edge Functions (service-role, with code fallback); updatable from the app by admin / operations_manager.';

-- Stamp updated_at + updated_by on every edit.
create or replace function public.set_app_setting_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_app_settings_updated
  before update on public.app_settings
  for each row execute function public.set_app_setting_updated();

-- RLS ------------------------------------------------------------------------
-- Read + Update for admin / super_admin / operations_manager (the app's canEdit
-- gate). No insert/delete policy: the key set is fixed in migrations. Edge
-- Functions use the service-role key, which bypasses RLS.
alter table public.app_settings enable row level security;

create policy app_settings_read on public.app_settings
  for select using (auth_role() in ('super_admin', 'admin', 'operations_manager'));

create policy app_settings_write on public.app_settings
  for update using (auth_role() in ('super_admin', 'admin', 'operations_manager'))
            with check (auth_role() in ('super_admin', 'admin', 'operations_manager'));

-- Seed — the current hardcoded behaviour, unchanged ---------------------------
-- lead_weeks 5 + window_days 7 reproduces the existing "+35d, for 7 days".
insert into public.app_settings (key, value, label, description)
values (
  'booking_sync_range',
  '{"lead_weeks": 5, "window_days": 7}'::jsonb,
  'Booking sync date range',
  'How far ahead the Weekly Booking Sync looks, and how many days it covers. The range is anchored to the day the job runs, so it rolls forward every week.'
);

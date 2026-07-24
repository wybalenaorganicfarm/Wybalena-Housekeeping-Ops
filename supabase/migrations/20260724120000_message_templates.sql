-- ============================================================================
-- Wybalena Housekeeping Operations — Editable WhatsApp message templates
-- ============================================================================
-- The core cleaner-facing WhatsApp messages (offer, accept/decline/cancel
-- confirmations, and the two reminders) are stored here so an Admin or
-- Operations Manager can reword them from the app — no redeploy needed.
--
-- Edge Functions READ this table via the service-role key (bypasses RLS) and
-- fall back to their built-in default text if a row is missing, so a send can
-- never fail because a template was deleted or the table isn't migrated yet.
-- The frontend may only UPDATE rows (no insert/delete): the set of keys is
-- fixed and each maps to exactly one place a message is sent.
--
-- Placeholders use {{double_braces}}; each row lists the variables it supports
-- in `variables` so the UI can offer them. `defaults` is an untouched snapshot
-- of the seeded text, powering the "Reset to default" button.
-- ============================================================================

create table public.message_templates (
  key         text primary key,               -- machine key matched by Edge Functions
  category    text not null,                   -- UI grouping, e.g. 'Reminders'
  label       text not null,                   -- human title, e.g. 'Shift offer'
  description text not null,                   -- when/who it is sent to
  channel     text not null default 'whatsapp',
  body        text not null,                   -- main message text ({{vars}})
  header      text,                            -- interactive-message header (optional)
  footer      text,                            -- interactive-message footer (optional)
  fallback    text,                            -- plain-text fallback if buttons fail
  buttons     jsonb,                           -- [{ "id": "accept", "title": "✅ Accept" }]
  variables   jsonb not null default '[]'::jsonb,  -- [{ "name", "description" }]
  defaults    jsonb not null default '{}'::jsonb,  -- seeded snapshot for Reset-to-default
  sort_order  int  not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.message_templates is
  'Editable WhatsApp message templates. Read by Edge Functions (service-role, with code fallback); updatable from the app by admin / operations_manager.';

-- Stamp updated_at + updated_by on every edit.
create or replace function public.set_template_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_message_templates_updated
  before update on public.message_templates
  for each row execute function public.set_template_updated();

-- RLS -----------------------------------------------------------------------
-- Read + Update for admin / super_admin / operations_manager (same set as the
-- app's canEdit gate). No insert/delete policy: the key set is fixed. Edge
-- Functions use the service-role key, which bypasses RLS.
alter table public.message_templates enable row level security;

create policy message_templates_read on public.message_templates
  for select using (auth_role() in ('super_admin', 'admin', 'operations_manager'));

create policy message_templates_write on public.message_templates
  for update using (auth_role() in ('super_admin', 'admin', 'operations_manager'))
            with check (auth_role() in ('super_admin', 'admin', 'operations_manager'));

-- Seed — exact current copy ---------------------------------------------------
insert into public.message_templates
  (key, category, label, description, body, header, footer, fallback, buttons, variables, sort_order)
values
  (
    'shift_offer',
    'Offer & acceptance',
    'Shift offer',
    'Sent to one cleaner per message when a shift is offered (Tier 1/2/3 or manual). Interactive Accept / Decline buttons.',
    E'*SHIFT DETAILS*\n\n📅 Date: {{shift_date}}\n⏰ Time: {{start_time}}\n\nTap *Accept* to take this shift, or *Decline* to pass.',
    E'🧹 New Cleaning Shift Available',
    E'Wybalena Organic Farm',
    E'New cleaning shift on {{shift_date}} at {{start_time}}. Please open WhatsApp and tap Accept or Decline on the offer.',
    '[{"id":"accept","title":"✅ Accept"},{"id":"decline","title":"❌ Decline"}]'::jsonb,
    '[{"name":"shift_date","description":"Shift date, e.g. 2026-07-25"},{"name":"start_time","description":"Start time, HH:MM"}]'::jsonb,
    1
  ),
  (
    'accept_confirmation',
    'Offer & acceptance',
    'Accept confirmation',
    'Sent to the cleaner immediately after they accept. Carries the Cancel button they use later to drop the shift.',
    E'Shift Accepted ✅',
    null,
    E'Wybalena Organic Farm',
    null,
    '[{"id":"cancel","title":"🚫 Cancel"}]'::jsonb,
    '[]'::jsonb,
    2
  ),
  (
    'decline_prompt',
    'Confirmations',
    'Decline — are you sure?',
    'Shown when a cleaner taps Decline. A single tap never declines; the offer stays open until Yes is tapped.',
    E'Are you sure you want to decline?',
    null,
    E'Wybalena Organic Farm',
    null,
    '[{"id":"declineyes","title":"✅ Yes, decline"},{"id":"declineno","title":"↩️ No, keep offer"}]'::jsonb,
    '[]'::jsonb,
    3
  ),
  (
    'cancel_prompt',
    'Confirmations',
    'Cancel — are you sure?',
    'Shown when a cleaner taps Cancel on their confirmation. Wording differs from the decline prompt on purpose.',
    E'Are you sure you want to cancel?',
    null,
    E'Wybalena Organic Farm',
    null,
    '[{"id":"cancelyes","title":"✅ Yes, cancel"},{"id":"cancelno","title":"↩️ No, keep shift"}]'::jsonb,
    '[]'::jsonb,
    4
  ),
  (
    'reminder_nonresponder',
    'Reminders',
    'Reminder — no reply to an offer',
    'Sent once per offer to cleaners who were offered a shift and have not yet replied.',
    E'Reminder: please respond to the cleaning shift offer on {{shift_date}}.\nTap Accept or Decline on the offer.',
    null,
    null,
    null,
    null,
    '[{"name":"shift_date","description":"Shift date, e.g. 2026-07-25"}]'::jsonb,
    5
  ),
  (
    'reminder_preshift',
    'Reminders',
    'Reminder — shift is tomorrow',
    'Sent the day before the shift to every cleaner who accepted.',
    E'Reminder: your {{shift_type}} clean is tomorrow ({{shift_date}}) at {{start_time}}. See you there!',
    null,
    null,
    null,
    null,
    '[{"name":"shift_type","description":"Shift type, e.g. standard"},{"name":"shift_date","description":"Shift date, e.g. 2026-07-25"},{"name":"start_time","description":"Start time"}]'::jsonb,
    6
  );

-- Snapshot the seeded copy into `defaults` so the UI can reset any edit.
update public.message_templates
set defaults = jsonb_build_object(
  'body', body, 'header', header, 'footer', footer, 'fallback', fallback, 'buttons', buttons
);

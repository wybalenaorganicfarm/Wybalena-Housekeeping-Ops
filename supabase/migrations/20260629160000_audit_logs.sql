-- ============================================================================
-- Wybalena Housekeeping Operations — Audit Logs
-- ============================================================================
-- A plain-English, client-readable record of everything the background system
-- does: calendar syncs, WhatsApp offers, tier escalations, reminders, inbound
-- replies. Edge Functions write here via the service-role key (bypasses RLS);
-- the frontend reads only. Never written from the frontend.
-- ============================================================================

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,                 -- machine key, e.g. 'shift.created'
  event_label   text not null,                 -- human title, e.g. 'Shift Created'
  status        text not null
                  check (status in ('success', 'failed', 'skipped', 'warning')),
  summary       text not null,                 -- plain-English one-liner for the client
  detail        jsonb,                         -- optional structured detail (ids, counts)
  error_message text,                          -- populated when status = 'failed'
  source        text not null,                 -- firing function: 'sync-bookings', etc.
  shift_id      uuid references public.shifts (id)   on delete set null,
  booking_id    uuid references public.bookings (id) on delete set null,
  cleaner_id    uuid references public.cleaners (id) on delete set null,
  triggered_by  text not null
                  check (triggered_by in ('cron', 'webhook', 'manual', 'system')),
  created_at    timestamptz not null default now()
);

comment on table public.audit_logs is 'Client-readable activity log of all background system actions. Written by Edge Functions (service-role); read-only from the frontend.';

-- Indexes (Spec §1) ---------------------------------------------------------
create index idx_audit_logs_created_at on public.audit_logs (created_at desc); -- timeline
create index idx_audit_logs_status     on public.audit_logs (status);          -- filter failures
create index idx_audit_logs_source     on public.audit_logs (source);          -- filter by function
create index idx_audit_logs_shift_id   on public.audit_logs (shift_id);        -- entity lookup
create index idx_audit_logs_cleaner_id on public.audit_logs (cleaner_id);      -- entity lookup

-- RLS -----------------------------------------------------------------------
-- Super Admin + Admin may SELECT. Team Leader has no access. No frontend
-- insert/update/delete policy exists, so all writes come from the service-role
-- key in Edge Functions (which bypasses RLS by design).
alter table public.audit_logs enable row level security;

create policy admins_read_audit_logs on public.audit_logs
  for select using (auth_role() in ('super_admin', 'admin'));

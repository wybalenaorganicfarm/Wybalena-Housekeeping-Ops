-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 4
-- cleaners (the workforce roster, max 20 active)
-- ============================================================================
-- People contacted via WhatsApp. NOT app users; no auth record.
-- Zara = one cleaners row (is_team_leader = true, the "+1") AND a separate
-- profiles row (her read-only login). Two records by design.
-- Reliability counts are DERIVED (see cleaner_reliability view), not stored.
-- ============================================================================

create table public.cleaners (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  phone           text not null,                       -- WhatsApp-enabled number
  email           text,                                -- nullable. Spec extension:
                                                        -- the add-cleaner UI collects an
                                                        -- optional email; cleaners are not
                                                        -- app users so it is informational only.
  tier            cleaner_tier not null,
  is_active       boolean not null default true,
  is_team_leader  boolean not null default false,      -- true for Zara
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.cleaners is 'WhatsApp-contacted workforce. Not app users. Reliability derived via cleaner_reliability view.';
comment on column public.cleaners.email is 'Optional, informational only (UI collects it). Cleaners are not app logins.';

create trigger trg_cleaners_updated_at
  before update on public.cleaners
  for each row execute function public.set_updated_at();

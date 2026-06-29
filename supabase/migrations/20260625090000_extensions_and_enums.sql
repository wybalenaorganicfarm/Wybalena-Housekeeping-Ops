-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 1
-- Extensions + Enums
-- ============================================================================
-- Single venue (Wybalena Organic Farm). No venues table by design.
-- Run order: this file FIRST. All later migrations depend on these enums.
-- ============================================================================

-- --- Extensions ---------------------------------------------------------------
-- pgcrypto: gen_random_uuid(). pg_cron + pg_net: scheduled invocation of Edge
-- Functions (wired in a later migration, Section 7.1 schedules).
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- --- Enums (Spec Section 4) ---------------------------------------------------
create type user_role         as enum ('super_admin', 'admin', 'team_leader');
create type cleaner_tier       as enum ('tier_1', 'tier_2', 'tier_3');
create type shift_type         as enum ('standard', 'deep_full_venue', 'mid_retreat', 'other');
create type shift_status       as enum ('pending_confirmation', 'confirmed', 'staffing', 'fully_staffed', 'cancelled');
create type shift_source       as enum ('auto', 'manual');
create type assignment_status  as enum ('offered', 'accepted', 'declined', 'cancelled', 'no_response');
create type alert_type         as enum ('venue_gap', 'unconfirmed_shifts', 'booking_cancelled', 'understaffed_urgent', 'cleaner_cancelled');
create type alert_status       as enum ('open', 'actioned', 'dismissed');

-- --- Shared trigger: keep updated_at current ----------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

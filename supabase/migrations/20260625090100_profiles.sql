-- ============================================================================
-- Wybalena Housekeeping Operations — Phase A, Step 3
-- profiles (app logins) + auth-insert trigger + auth_role() helper
-- ============================================================================
-- One row per app login (Julian/super_admin, Ashley/admin, Zara-as-user/
-- team_leader, future staff). NOT cleaners. Extends auth.users.
-- ============================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        user_role not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'App users (logins). Not cleaners. One row per auth.users record.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- --- Auto-create a profile when an auth user is created -----------------------
-- Standard Supabase pattern. Role + full_name are read from the user metadata
-- supplied at creation time (the provision-user Edge Function sets these via the
-- admin API). Defaults to least-privilege 'team_leader' if role metadata absent.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'team_leader')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- auth_role() helper -------------------------------------------------------
-- Returns the requesting user's role for use in RLS policies.
-- Fast path: read a custom JWT claim ('user_role') set by a Supabase custom
-- access token auth hook (configured at project level — see project docs).
-- Fallback: look the role up from profiles (works before the hook is wired).
create or replace function public.auth_role()
returns user_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claim_role text;
  result     user_role;
begin
  -- Fast path: custom claim injected by the auth hook.
  claim_role := nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'user_role',
    ''
  );
  if claim_role is not null then
    return claim_role::user_role;
  end if;

  -- Fallback: resolve from profiles by the JWT subject (auth.uid()).
  select p.role into result
  from public.profiles p
  where p.id = auth.uid();

  return result;
end;
$$;

comment on function public.auth_role() is
  'Requesting user role for RLS. Prefers JWT custom claim user_role; falls back to profiles lookup.';

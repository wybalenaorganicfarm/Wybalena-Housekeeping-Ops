-- ============================================================================
-- Wybalena Housekeeping Operations — Test login users
-- ============================================================================
-- Creates three real auth users (email/password) + their profiles so the app
-- can be exercised end to end across all three roles.
--
-- Passwords are bcrypt-hashed at insert time via pgcrypto. Users are inserted
-- PRE-CONFIRMED (email_confirmed_at = now()) so they can sign in immediately —
-- a SQL migration cannot make GoTrue send a verification email (that only
-- happens through the Auth signup/invite API), so we confirm them directly.
--
-- ⚠️ This file contains plaintext TEST passwords. Rotate them (or delete these
--    users) before any real/production use.
--
-- Idempotent: skips any email that already exists.
-- ============================================================================

set search_path = public, extensions;

do $$
declare
  rec     record;
  new_id  uuid;
begin
  for rec in
    select * from (values
      ('admin@growwstacks.com',          'Groww@2026', 'Ashleigh (Admin)',          'admin'),
      ('yashasvi.growwstacks@gmail.com', 'Yashi@2026', 'Yashasvi (Super Admin)',    'super_admin'),
      ('yashasvi.sharma@growwstacks.com','Yashu@2026', 'Yashasvi Sharma (Team Lead)','team_leader')
    ) as t(email, password, full_name, role)
  loop
    -- Skip if this email already exists in auth.
    if exists (select 1 from auth.users where email = rec.email) then
      continue;
    end if;

    new_id := gen_random_uuid();

    -- 1) Auth user (pre-confirmed, email/password provider).
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_id,
      'authenticated',
      'authenticated',
      rec.email,
      crypt(rec.password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', rec.full_name, 'role', rec.role, 'email_verified', true),
      now(), now(),
      '', '', '', ''
    );

    -- 2) Email identity (required for password sign-in).
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      new_id::text,
      new_id,
      jsonb_build_object('sub', new_id::text, 'email', rec.email, 'email_verified', true),
      'email',
      now(), now(), now()
    );

    -- 3) Profile (the handle_new_user trigger also creates this from the
    --    metadata above; upsert here guarantees role/full_name regardless).
    insert into public.profiles (id, email, full_name, role, is_active)
    values (new_id, rec.email, rec.full_name, rec.role::user_role, true)
    on conflict (id) do update
      set role = excluded.role,
          full_name = excluded.full_name;
  end loop;
end $$;

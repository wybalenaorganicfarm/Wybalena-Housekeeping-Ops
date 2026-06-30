-- ============================================================================
-- Wybalena Housekeeping Operations — Phase B, Step 19
-- pg_cron schedules (Spec §7.1)
-- ============================================================================
-- TIMEZONE — TESTING (Asia/Calcutta, IST, UTC+5:30, no DST):
-- pg_cron fires in UTC only. Each fixed-time job below is expressed in IST and
-- converted to UTC by subtracting 5h30m. IST has no daylight saving, so every
-- conversion is a single stable expression. Each schedule carries a comment
-- showing the UTC cron expression and the IST local time it represents.
-- Cron controls the exact fire time; the Edge Functions no longer gate on local
-- time (the hourly +5h / +18h jobs still evaluate their age condition in code).
--
-- ⚠ GO-LIVE (Australia): before production, recalculate EVERY expression for the
--   confirmed venue timezone. Victoria/NSW (Australia/Melbourne, UTC+11/+10 with
--   DST) needs two expressions per job (summer/winter). Queensland
--   (Australia/Brisbane, UTC+10, no DST) is a single fixed offset. Confirm the
--   venue timezone with the client first.
--
-- Functions are invoked with pg_net. The base URL + service-role key are read
-- from Vault so no secret is committed to this migration.
--
-- ── ONE-TIME SETUP (run once, NOT in version control) ───────────────────────
--   select vault.create_secret('https://wctunwynyugdncbiwwhs.functions.supabase.co', 'edge_base_url');
--   select vault.create_secret('<YOUR_SERVICE_ROLE_KEY>', 'edge_service_key');
-- ============================================================================

-- Helper: invoke an Edge Function by name using the Vault-stored creds.
create or replace function public.invoke_edge(fn text)
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  base_url text;
  svc_key  text;
  req_id   bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into svc_key  from vault.decrypted_secrets where name = 'edge_service_key';
  if base_url is null or svc_key is null then
    raise notice 'invoke_edge(%): missing edge_base_url / edge_service_key vault secrets', fn;
    return null;
  end if;

  select net.http_post(
    url     := base_url || '/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || svc_key
               ),
    body    := '{}'::jsonb
  ) into req_id;
  return req_id;
end;
$$;

comment on function public.invoke_edge(text) is 'Invoke a Supabase Edge Function by name via pg_net using Vault creds. Used by pg_cron.';

-- Idempotent (re)scheduling: unschedule then schedule.
do $$
declare
  j record;
begin
  for j in select jobname from cron.job where jobname like 'wy-%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end;
$$;

-- IST testing schedules (UTC cron — IST local time).
-- TEST-DAY OVERRIDE (Tuesday end-to-end run): the weekly jobs are pinned to this
-- Tuesday's afternoon IST slots; the three "daily" jobs run every evening IST.
-- confirm-reminder / remind-nonresponders still gate on created_at+5h / offered_at+18h
-- in code, so seed timestamps accordingly for a live test.
select cron.schedule('wy-sync-bookings',         '0 8 * * 2',   $$ select public.invoke_edge('sync-bookings') $$);          -- 08:00 UTC Tue — Tue 13:30 IST
select cron.schedule('wy-confirm-reminder',      '0 9 * * 2',   $$ select public.invoke_edge('confirm-reminder') $$);       -- 09:00 UTC Tue — Tue 14:30 IST
select cron.schedule('wy-offer-tier-1',          '30 9 * * 2',  $$ select public.invoke_edge('offer-tier-1') $$);           -- 09:30 UTC Tue — Tue 15:00 IST
select cron.schedule('wy-remind-nonresponders',  '0 10 * * 2',  $$ select public.invoke_edge('remind-nonresponders') $$);   -- 10:00 UTC Tue — Tue 15:30 IST
select cron.schedule('wy-escalate-tier-2',       '30 10 * * 2', $$ select public.invoke_edge('escalate-tier-2') $$);        -- 10:30 UTC Tue — Tue 16:00 IST
select cron.schedule('wy-escalate-tier-3',       '0 11 * * 2',  $$ select public.invoke_edge('escalate-tier-3') $$);        -- 11:00 UTC Tue — Tue 16:30 IST
select cron.schedule('wy-pre-shift-reminder',    '30 11 * * *', $$ select public.invoke_edge('pre-shift-reminder') $$);     -- 11:30 UTC — daily 17:00 IST
select cron.schedule('wy-cancellation-followup', '30 12 * * *', $$ select public.invoke_edge('cancellation-followup') $$);  -- 12:30 UTC — daily 18:00 IST
-- Daily connection health check (read-only probes; not in the spec's 8 jobs).
select cron.schedule('wy-health-check',          '0 13 * * *',  $$ select public.invoke_edge('health-check') $$);           -- 13:00 UTC — daily 18:30 IST

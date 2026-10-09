-- ============================================================================
-- Automatic daylight-saving reconciliation for the scheduled jobs.
--
-- THE PROBLEM
--   pg_cron fires on a FIXED UTC expression. The venue runs Australia/Sydney,
--   which switches AEST (UTC+10) ↔ AEDT (UTC+11) twice a year. When the app saves
--   "3 PM", it converts to the UTC time that is 3 PM *at that moment* and stores
--   it. Months later the clocks shift, that fixed UTC time is now 2 PM or 4 PM
--   local, and every job drifts an hour — exactly what the venue hit this week.
--   pg_cron has no per-job timezone, so a stored expression cannot follow DST on
--   its own. (See the warning in src/lib/cron.ts.)
--
-- THE FIX
--   Pin each managed job to its INTENDED LOCAL TIME and re-derive the UTC
--   expression whenever the Sydney offset changes. A daily job runs the
--   reconciler, so within 24h of a DST switch every wy-* job is corrected back to
--   the local time the admin set — with no manual re-saving, twice a year, forever.
--
--   The reconciler is SELF-BOOTSTRAPPING: the first time it sees a job it records
--   the local time implied by the job's current UTC expression at the current
--   offset, then keeps it pinned to that local time thereafter. So it simply adopts
--   whatever times are set right now (which the venue has just corrected) — no app
--   change, no re-entry. When the admin later changes a time from the Schedule
--   page, admin_set_cron_schedule re-records the new local intent (below), so the
--   reconciler tracks edits too.
--
--   Only minute+hour and dow are touched; the command string is never altered, so
--   this can only ever change WHEN a known job fires, never WHAT it runs.
-- ============================================================================

-- Each managed job's intended LOCAL (Australia/Sydney) fire time. dow is a cron
-- day-of-week list ('*' for daily) in LOCAL terms. Rewritten whenever a schedule
-- is saved; read by the reconciler to compute the correct UTC expression for the
-- current offset.
create table if not exists public.cron_local_time (
  jobname      text primary key,
  local_minute int  not null check (local_minute between 0 and 59),
  local_hour   int  not null check (local_hour   between 0 and 23),
  local_dow    text not null default '*',     -- '*' or comma list of 0..6 (0=Sun), LOCAL
  updated_at   timestamptz not null default now()
);

comment on table public.cron_local_time is
  'Intended LOCAL (Australia/Sydney) fire time per wy-* job. Source of truth the DST reconciler re-resolves to a UTC cron expression as the offset changes.';

-- Infrastructure table, touched only by the SECURITY DEFINER functions below
-- (which run as the owner) and never by a client. RLS on with NO policy denies all
-- direct access from anon/authenticated — the safe default, matching every other
-- table in the schema.
alter table public.cron_local_time enable row level security;

-- Sydney offset in MINUTES (e.g. 600 = +10 AEST, 660 = +11 AEDT) right now.
create or replace function public.sydney_offset_minutes()
returns int
language sql
stable
as $$
  select (extract(epoch from (now() at time zone 'Australia/Sydney') - (now() at time zone 'UTC')) / 60)::int;
$$;

-- Build the UTC cron expression for a LOCAL time at the CURRENT offset.
-- local minute-of-day shifts by -offset to UTC; a crossing of UTC midnight shifts
-- every weekday in the dow list by the same -1/0/+1 day.
create or replace function public.local_to_utc_cron(
  p_local_minute int,
  p_local_hour   int,
  p_local_dow    text
)
returns text
language plpgsql
stable
as $$
declare
  off_min   int := public.sydney_offset_minutes();
  local_mod int := p_local_hour * 60 + p_local_minute;
  utc_mod   int;
  day_delta int;
  u_hour    int;
  u_min     int;
  d         text;
  utc_days  int[] := '{}';
begin
  utc_mod   := ((local_mod - off_min) % 1440 + 1440) % 1440;
  day_delta := floor((local_mod - off_min)::numeric / 1440);  -- -1, 0
  u_hour    := utc_mod / 60;
  u_min     := utc_mod % 60;

  if p_local_dow = '*' or p_local_dow is null then
    return format('%s %s * * *', u_min, u_hour);
  end if;

  foreach d in array string_to_array(p_local_dow, ',') loop
    utc_days := utc_days || ((((d::int + day_delta) % 7) + 7) % 7);
  end loop;
  -- de-dup + sort
  select array_agg(x order by x) into utc_days
  from (select distinct unnest(utc_days) as x) s;

  return format('%s %s * * %s', u_min, u_hour, array_to_string(utc_days, ','));
end;
$$;

-- Record (or update) a job's intended LOCAL time from a UTC cron expression,
-- interpreting that expression at the CURRENT offset. Used to bootstrap existing
-- jobs and to capture an admin's edit (called from admin_set_cron_schedule).
create or replace function public.record_cron_local_time(p_jobname text, p_utc_schedule text)
returns void
language plpgsql
as $$
declare
  parts     text[] := regexp_split_to_array(trim(p_utc_schedule), '\s+');
  u_min     int;
  u_hour    int;
  u_dow     text;
  off_min   int := public.sydney_offset_minutes();
  local_mod int;
  day_delta int;
  l_hour    int;
  l_min     int;
  l_dow     text;
  d         text;
  loc_days  int[] := '{}';
begin
  if array_length(parts, 1) <> 5 then return; end if;
  -- Only the simple minute/hour expressions this app produces are reconciled.
  if parts[1] !~ '^\d{1,2}$' or parts[2] !~ '^\d{1,2}$' then return; end if;
  if parts[3] <> '*' or parts[4] <> '*' then return; end if;

  u_min  := parts[1]::int;
  u_hour := parts[2]::int;
  u_dow  := parts[5];

  local_mod := (((u_hour * 60 + u_min + off_min) % 1440) + 1440) % 1440;
  day_delta := floor((u_hour * 60 + u_min + off_min)::numeric / 1440);  -- 0, +1
  l_hour := local_mod / 60;
  l_min  := local_mod % 60;

  if u_dow = '*' then
    l_dow := '*';
  else
    foreach d in array string_to_array(u_dow, ',') loop
      -- cron allows 7 for Sunday; normalise to 0.
      loc_days := loc_days || (((((case when d::int = 7 then 0 else d::int end) + day_delta) % 7) + 7) % 7);
    end loop;
    select string_agg(x::text, ',' order by x) into l_dow
    from (select distinct unnest(loc_days) as x) s;
  end if;

  insert into public.cron_local_time (jobname, local_minute, local_hour, local_dow, updated_at)
  values (p_jobname, l_min, l_hour, coalesce(l_dow, '*'), now())
  on conflict (jobname) do update
    set local_minute = excluded.local_minute,
        local_hour   = excluded.local_hour,
        local_dow    = excluded.local_dow,
        updated_at   = now();
end;
$$;

-- The reconciler: for every managed job, make sure its UTC expression matches its
-- intended local time at TODAY's offset; rewrite only the ones that drifted.
-- Bootstraps any job with no recorded local time from its current expression.
create or replace function public.reconcile_cron_timezones()
returns int
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  j         record;
  want      text;
  fixed     int := 0;
begin
  for j in
    select jobname, schedule, command, active
    from cron.job
    where jobname like 'wy-%'
      and jobname <> 'wy-dst-reconcile'   -- never reschedule the reconciler itself
  loop
    -- Bootstrap: learn this job's intended local time from its current schedule.
    if not exists (select 1 from public.cron_local_time t where t.jobname = j.jobname) then
      perform public.record_cron_local_time(j.jobname, j.schedule);
    end if;

    select public.local_to_utc_cron(local_minute, local_hour, local_dow)
      into want
    from public.cron_local_time
    where jobname = j.jobname;

    if want is not null and want <> j.schedule then
      -- Reschedule in place; command is preserved exactly (never rebuilt here).
      perform cron.schedule(j.jobname, want, j.command);
      -- cron.schedule() upserts with active = true and does NOT preserve a prior
      -- paused state, so re-apply the job's previous active flag. Without this, a
      -- job an admin had turned OFF would silently switch back ON at the DST
      -- changeover — breaking the "everything stays switchable" rule.
      perform cron.alter_job(
        job_id := (select jobid from cron.job where jobname = j.jobname),
        active := j.active
      );
      fixed := fixed + 1;
    end if;
  end loop;
  return fixed;
end;
$$;

revoke all on function public.reconcile_cron_timezones() from public, anon, authenticated;
grant execute on function public.reconcile_cron_timezones() to service_role;

-- Run the reconciler daily. It is cheap and idempotent — on all but the two DST
-- changeover days it finds nothing to do. 02:30 UTC = ~1:30pm AEST / 2:30am…
-- the time of day is irrelevant (it only needs to run once a day), but keeping it
-- off the top of the hour avoids piling onto the other jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'wy-dst-reconcile') then
    perform cron.unschedule('wy-dst-reconcile');
  end if;
end;
$$;
select cron.schedule('wy-dst-reconcile', '30 2 * * *', $$ select public.reconcile_cron_timezones() $$);

-- Bootstrap immediately so the local-time table is populated from the CURRENT
-- (just-corrected) schedules, and fix anything already drifting.
select public.reconcile_cron_timezones();

-- Capture future edits: when a schedule is saved from the app, record its local
-- intent too, so the reconciler keeps tracking the admin's chosen time. This
-- REPLACES the function from 20260701120000_cron_management.sql, adding only the
-- record_cron_local_time call — the scheduling behaviour is otherwise unchanged.
create or replace function public.admin_set_cron_schedule(
  p_fn       text,
  p_schedule text,
  p_active   boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  jname text := 'wy-' || p_fn;
  jid   bigint;
begin
  perform cron.schedule(jname, p_schedule, format('select public.invoke_edge(%L)', p_fn));
  select jobid into jid from cron.job where jobname = jname;
  if jid is not null then
    perform cron.alter_job(job_id := jid, active := p_active);
  end if;
  -- Remember the LOCAL time this UTC expression represents right now, so DST
  -- reconciliation keeps this job pinned to the time the admin actually chose.
  perform public.record_cron_local_time(jname, p_schedule);
end;
$$;

revoke all on function public.admin_set_cron_schedule(text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_cron_schedule(text, text, boolean) to service_role;

-- wy-dst-reconcile is NOT added to manage-cron's KNOWN_FNS / the Schedule page on
-- purpose: it is infrastructure, not a venue-facing automation, and its own time
-- of day doesn't matter. It also has no local-time row, so the reconciler leaves
-- its schedule alone (it only touches jobs it has an intended local time for and
-- that still drift — and it never records one for itself here).

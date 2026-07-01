-- ============================================================================
-- Automation Schedule management — RPCs behind the /schedule page.
--
-- pg_cron's cron.job table lives in the `cron` schema, which PostgREST does not
-- expose. These SECURITY DEFINER wrappers in `public` let the manage-cron Edge
-- Function (service-role) read and reschedule the `wy-*` jobs seeded in
-- 20260625100100_cron.sql without granting broad access to the cron schema.
--
-- The command each job runs is fixed here (select public.invoke_edge('<fn>'))
-- so a caller can only change WHEN a known job fires, never WHAT it runs.
-- ============================================================================

-- List the managed jobs (jobname stripped of the 'wy-' prefix → function name).
create or replace function public.admin_list_cron_jobs()
returns table(fn text, jobname text, schedule text, active boolean)
language sql
security definer
set search_path = public, cron
as $$
  select substring(j.jobname from 4) as fn, j.jobname, j.schedule, j.active
  from cron.job j
  where j.jobname like 'wy-%'
  order by j.jobname;
$$;

comment on function public.admin_list_cron_jobs() is
  'List managed pg_cron jobs (wy-*) for the Automation Schedule page.';

-- (Re)schedule and enable/disable one managed job by its function name.
-- cron.schedule upserts on jobname; the command is always regenerated here so
-- it can never be tampered with from the client.
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
end;
$$;

comment on function public.admin_set_cron_schedule(text, text, boolean) is
  'Reschedule / enable / disable a managed pg_cron job by function name.';

-- Only the service-role (used by the manage-cron Edge Function) may call these.
revoke all on function public.admin_list_cron_jobs() from public, anon, authenticated;
revoke all on function public.admin_set_cron_schedule(text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_list_cron_jobs() to service_role;
grant execute on function public.admin_set_cron_schedule(text, text, boolean) to service_role;

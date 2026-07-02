-- ============================================================================
-- Notes: shift special-instruction authorship + per-cleaner notes.
-- ============================================================================

-- --- Shift special instructions: track who last set them --------------------
alter table public.shifts
  add column if not exists special_instructions_by uuid references public.profiles (id) on delete set null,
  add column if not exists special_instructions_at timestamptz;

-- --- Cleaner notes: multiple free-text notes per cleaner, with author -------
create table if not exists public.cleaner_notes (
  id          uuid primary key default gen_random_uuid(),
  cleaner_id  uuid not null references public.cleaners (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_cleaner_notes_cleaner
  on public.cleaner_notes (cleaner_id, created_at desc);

comment on table public.cleaner_notes is 'Free-text notes attached to a cleaner. author_id defaults to auth.uid() so the writer is always recorded.';

alter table public.cleaner_notes enable row level security;

-- admin + super_admin manage; team_leader may read (mirrors cleaners policy).
create policy cleaner_notes_admin_write on public.cleaner_notes
  for all   using (auth_role() in ('admin','super_admin'))
            with check (auth_role() in ('admin','super_admin'));

create policy cleaner_notes_read_all on public.cleaner_notes
  for select using (auth_role() in ('admin','super_admin','team_leader'));

-- --- Batch author-name resolver (RLS-safe) ----------------------------------
-- profiles reads are limited by role, so resolve display names via a SECURITY
-- DEFINER function used for both note authors and shift-instruction authors.
create or replace function public.profile_names(ids uuid[])
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email)
  from public.profiles p
  where p.id = any(ids);
$$;

grant execute on function public.profile_names(uuid[]) to authenticated, anon;

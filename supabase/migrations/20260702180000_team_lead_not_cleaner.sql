-- ============================================================================
-- Team leads are users (profiles), never cleaners. Their phone (used for the
-- manager WhatsApp summary) now lives on profiles, and any previously-mirrored
-- team-lead cleaner rows are removed.
-- ============================================================================

alter table public.profiles add column if not exists phone text;

-- Carry forward the phone from any existing team-lead cleaner row to the
-- matching profile (by email) before removing it.
update public.profiles p
set phone = c.phone
from public.cleaners c
where c.is_team_leader = true
  and lower(c.email) = lower(p.email)
  and p.phone is null;

-- Team leads should not exist in the cleaners roster.
delete from public.cleaners where is_team_leader = true;

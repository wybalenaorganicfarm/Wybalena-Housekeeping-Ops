-- Date-based offer codes: "0409" = 4th September, "0409-2" = second shift that day.
-- ============================================================================
-- The offer code is what lets the system tell WHICH shift a reply belongs to. It
-- was a random 4-digit number (gen4()), which worked technically but meant
-- nothing to the cleaner reading it.
--
-- Ashleigh asked for it to be the shift date instead — "0409" for 4 September —
-- so the reference on the button is self-explanatory rather than an opaque number.
-- Where two shifts fall on the SAME DAY (rare, but it happens), the second gets
-- "-2", the third "-3", and so on, so the code still identifies exactly one shift.
--
-- KEY CHANGE IN SHAPE: the code is now per-SHIFT, not per-assignment. Every
-- cleaner offered the same shift sees the same code, which is what makes it
-- meaningful to the team ("the 0409 shift"). Correlation still resolves to one
-- assignment because the webhook always matches code + cleaner together — see
-- ownedById() in whatsapp-inbound, which filters by cleaner_id.
--
-- Year is deliberately omitted: offers are answered within days, and the shorter
-- code keeps the button label well inside WhatsApp's 20-character limit
-- ("❌ Decline 0409" is 14, "❌ Decline 0409-2" is 16).
-- ============================================================================

alter table public.shifts
  add column if not exists offer_code text;

comment on column public.shifts.offer_code is
  'Human-readable reference shown on offer buttons and in the offer message: DDMM of the shift date, plus -2/-3 etc. when several shifts fall on the same day. Per-shift, so every cleaner offered it sees the same code.';

create unique index if not exists idx_shifts_offer_code
  on public.shifts (offer_code)
  where offer_code is not null;

-- Derive the code for one shift, taking the next free -N suffix for its date.
-- SECURITY DEFINER so it can read/lock the table when called from an Edge
-- Function under RLS; search_path pinned per Supabase linter guidance.
create or replace function public.assign_shift_offer_code(p_shift_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date  date;
  v_base  text;
  v_code  text;
  v_n     integer := 1;
begin
  select shift_date into v_date from public.shifts where id = p_shift_id;
  if v_date is null then
    return null;
  end if;

  -- Already assigned: keep it. The code is quoted in messages already sent, so
  -- it must never change once issued.
  select offer_code into v_code from public.shifts where id = p_shift_id;
  if v_code is not null then
    return v_code;
  end if;

  v_base := to_char(v_date, 'DDMM');

  -- First shift on a date takes the bare code; later ones take -2, -3, ...
  -- Loop rather than count(*) so a deleted shift can't cause a collision.
  loop
    v_code := case when v_n = 1 then v_base else v_base || '-' || v_n end;
    exit when not exists (select 1 from public.shifts where offer_code = v_code);
    v_n := v_n + 1;
  end loop;

  update public.shifts set offer_code = v_code where id = p_shift_id;
  return v_code;
end;
$$;

comment on function public.assign_shift_offer_code(uuid) is
  'Assigns and returns the DDMM(-N) offer code for a shift, or returns the existing one. Idempotent: a code already issued is never changed, because it appears in messages already sent.';

grant execute on function public.assign_shift_offer_code(uuid) to service_role;

-- Backfill existing shifts, oldest first so same-day suffixes follow creation
-- order. Only shifts that could still be replied to matter, but doing them all
-- keeps the column consistent and costs nothing at this table size.
do $$
declare r record;
begin
  for r in select id from public.shifts where offer_code is null order by shift_date, start_time, created_at loop
    perform public.assign_shift_offer_code(r.id);
  end loop;
end $$;

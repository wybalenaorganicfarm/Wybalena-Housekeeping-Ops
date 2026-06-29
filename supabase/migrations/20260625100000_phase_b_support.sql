-- ============================================================================
-- Wybalena Housekeeping Operations — Phase B support
-- offer_code (reply correlation) + processed_messages (webhook idempotency)
-- ============================================================================

-- Short code embedded in each outbound WhatsApp offer so a keyword reply
-- ("YES 4823") maps back to the exact shift_assignments row (Spec §7.5 #2).
alter table public.shift_assignments
  add column if not exists offer_code text;

create index if not exists idx_shift_assignments_offer_code
  on public.shift_assignments (offer_code);

-- Idempotency ledger for inbound Whapi webhooks. A re-delivered message id is
-- ignored so the action is never double-applied (Spec §7.5 #4).
create table if not exists public.processed_messages (
  provider_message_id text primary key,
  processed_at        timestamptz not null default now()
);

alter table public.processed_messages enable row level security;
-- No policies: this table is service-role only (Edge Functions bypass RLS).
-- The frontend never touches it.

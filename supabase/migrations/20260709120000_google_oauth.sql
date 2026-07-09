-- One-click Google reconnect: store the OAuth refresh token in the DB so an admin
-- can re-authorise Gmail + Calendar from the portal without touching the console.
-- The token is written by google-oauth-callback (service role) and read by the
-- google adapter. It is SECRET — RLS is on with NO policies, so neither anon nor
-- authenticated roles can read it; only the service-role key (edge functions) can.
create table if not exists public.integration_tokens (
  provider text primary key,               -- e.g. 'google'
  refresh_token text not null,
  connected_email text,                    -- which Google account is linked (for display)
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;
-- No policies on purpose: the refresh token must never reach the browser. The
-- portal reads connection STATUS via the get-connection-status edge function,
-- which returns metadata (email/connected_at) but never the token itself.

comment on table public.integration_tokens is
  'Secret OAuth refresh tokens for external integrations. Service-role only (RLS on, no policies).';

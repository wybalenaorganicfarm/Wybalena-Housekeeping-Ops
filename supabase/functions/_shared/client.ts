// Service-role Supabase client for Edge Functions.
// Edge Functions run server-side and use the service-role key, which BYPASSES
// RLS by design (system actions: calendar sync, shift creation, escalation,
// webhook processing). The service-role key must NEVER reach the frontend.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by the
// Supabase Edge runtime — no manual config needed.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Client scoped to the caller's JWT — used by app-facing functions that must
// know WHO is calling (e.g. provision-user checks the caller is super_admin).
export function userClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader ?? "" } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

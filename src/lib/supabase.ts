import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surface misconfig early rather than failing cryptically on first query.
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

// Frontend uses the ANON key + the user's JWT. RLS governs everything.
export const supabase = createClient<Database>(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Invoke an Edge Function with the current user's JWT. We attach the token
// EXPLICITLY from the live session (getSession refreshes it if expired) — relying
// on the client's implicit header can fall back to the anon key, which passes
// verify_jwt but resolves to no user server-side → the function returns 403
// "forbidden". Attaching the real token guarantees getCaller() sees the user.
export async function invokeFn<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const { data, error } = await supabase.functions.invoke(name, {
    body,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

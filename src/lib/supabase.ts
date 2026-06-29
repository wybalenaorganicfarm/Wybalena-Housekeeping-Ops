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

// Invoke an Edge Function with the current user's JWT attached automatically.
export async function invokeFn<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

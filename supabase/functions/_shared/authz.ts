// Authorization helper for app-facing functions. Resolves the caller's user id
// and role from their JWT (the frontend sends Authorization: Bearer <jwt>).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { userClient } from "./client.ts";

export interface Caller {
  userId: string;
  role: "super_admin" | "admin" | "team_leader" | null;
}

export async function getCaller(
  req: Request,
  sb: SupabaseClient,
): Promise<Caller | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const { data: { user } } = await userClient(authHeader).auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { userId: user.id, role: (profile?.role as Caller["role"]) ?? null };
}

export function isWriter(role: Caller["role"]): boolean {
  return role === "admin" || role === "super_admin";
}

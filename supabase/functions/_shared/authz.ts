// Authorization helper for app-facing functions. Resolves the caller's user id
// and role from their JWT (the frontend sends Authorization: Bearer <jwt>).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { userClient } from "./client.ts";

export interface Caller {
  userId: string;
  role: "super_admin" | "admin" | "operations_manager" | "team_leader" | null;
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
  // Operations Manager has the same full access as Admin.
  return role === "admin" || role === "super_admin" || role === "operations_manager";
}

// Team leaders may manage cleaner status + notes (but not other admin actions).
export function canManageCleaners(role: Caller["role"]): boolean {
  return isWriter(role) || role === "team_leader";
}

// Edit Roster (manual-assign / add / remove / withdraw on a shift). Writers get it,
// AND the Cleaning Manager (team_leader) — so she can fill or adjust a shift's
// roster over a weekend — but NOT the rest of a writer's powers (confirm/cancel/
// delete a shift, edit shift details, Schedule, Users, Logs). The individual
// endpoints keep their own extra guards (e.g. cancel-accepted still refuses to
// remove the Cleaning Manager herself off a non-wipeover shift).
export function canEditRoster(role: Caller["role"]): boolean {
  return isWriter(role) || role === "team_leader";
}

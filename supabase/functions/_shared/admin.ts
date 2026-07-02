// The Operations Manager is the recipient of all system emails and the person
// attributed to email-driven actions (e.g. confirming a shift from the email).
// Resolved from the profile with role = 'operations_manager'; falls back to the
// ALERT_EMAIL_TO env inbox (matched to a profile if possible) so emails still send
// before an operations manager is designated.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface OpsManager {
  name: string;
  email: string | null;
}

export async function opsManager(sb: SupabaseClient): Promise<OpsManager> {
  const { data: mgr } = await sb
    .from("profiles")
    .select("full_name, email")
    .eq("role", "operations_manager")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (mgr?.email) return { name: mgr.full_name ?? "Operations Manager", email: mgr.email };

  // Fallback: the configured alert inbox (and its profile name if it matches one).
  const inbox = Deno.env.get("ALERT_EMAIL_TO") ?? null;
  if (inbox) {
    const { data } = await sb.from("profiles").select("full_name").eq("email", inbox).maybeSingle();
    return { name: data?.full_name ?? "Operations Manager", email: inbox };
  }
  return { name: "Operations Manager", email: null };
}

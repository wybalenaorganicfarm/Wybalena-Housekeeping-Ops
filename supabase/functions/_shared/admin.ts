// Resolve the confirming admin's display name for plain-English audit summaries.
// Prefers the profile that owns the confirmation inbox (ALERT_EMAIL_TO); falls back
// to the first admin, then a generic label.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function resolveAdminName(sb: SupabaseClient): Promise<string> {
  const inbox = Deno.env.get("ALERT_EMAIL_TO");
  if (inbox) {
    const { data } = await sb.from("profiles").select("full_name").eq("email", inbox).maybeSingle();
    if (data?.full_name) return data.full_name;
  }
  const { data } = await sb.from("profiles").select("full_name").eq("role", "admin").order("created_at").limit(1).maybeSingle();
  return data?.full_name ?? "The admin";
}

// The Operations Manager is the recipient of EVERY system notification — booking
// and shift emails, the mid-retreat and wipeover notices, and the connection
// health alerts — on both email and WhatsApp. She runs the portal; admins are
// not notified. This is the single place that resolves who that is, so no send
// site can drift to a different audience.
//
// Resolved from the profile with role = 'operations_manager'; falls back to the
// ALERT_EMAIL_TO env inbox (matched to a profile if possible) so notifications
// still send before an operations manager is designated.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface OpsManager {
  name: string;
  email: string | null;
  // WhatsApp destination for notices that go out on both channels. Null when the
  // manager's profile has no phone — callers skip the WhatsApp leg rather than fail.
  phone: string | null;
}

// A profile phone that is present but blank is the same as no phone at all —
// `.not("phone","is",null)` would happily return an empty string and every send
// against it fails.
function cleanPhone(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

// Last-resort WhatsApp destination, mirroring ALERT_EMAIL_TO for email. Set this
// and a notice can still land somewhere when the manager's profile has no phone
// saved — which is exactly how the connection alert reached nobody for four days.
function envAlertPhone(): string | null {
  return cleanPhone(Deno.env.get("ALERT_WHATSAPP_TO"));
}

export async function opsManager(sb: SupabaseClient): Promise<OpsManager> {
  const envPhone = envAlertPhone();

  const { data: mgr } = await sb
    .from("profiles")
    .select("full_name, email, phone")
    .eq("role", "operations_manager")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (mgr?.email) {
    return {
      name: mgr.full_name ?? "Operations Manager",
      email: mgr.email,
      phone: cleanPhone(mgr.phone) ?? envPhone,
    };
  }

  // Fallback: the configured alert inbox (and its profile name if it matches one).
  const inbox = Deno.env.get("ALERT_EMAIL_TO") ?? null;
  if (inbox) {
    const { data } = await sb.from("profiles").select("full_name, phone").eq("email", inbox).maybeSingle();
    return {
      name: data?.full_name ?? "Operations Manager",
      email: inbox,
      phone: cleanPhone(data?.phone) ?? envPhone,
    };
  }
  return { name: "Operations Manager", email: null, phone: envPhone };
}

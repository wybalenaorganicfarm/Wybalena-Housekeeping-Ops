// provision-user — app-facing. Julian (super_admin ONLY) invites an app user.
// Uses the invite flow: the user receives an email invitation and CANNOT log in
// until they accept it and set their own password. Role/full_name are carried in
// user metadata; the handle_new_user trigger then creates the profile (Spec §7.3).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const VALID_ROLES = ["super_admin", "admin", "team_leader"];
const ROLE_WORD: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", team_leader: "Team Leader" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  // User management is super_admin's alone (per the brief).
  if (!caller || caller.role !== "super_admin") return json({ error: "forbidden" }, 403);

  const { email, full_name, role, phone, redirectTo } = await req.json().catch(() => ({}));
  if (!email || !role) return json({ error: "email, role required" }, 400);
  if (!VALID_ROLES.includes(role)) return json({ error: "invalid role" }, 400);
  // A team leader is also a cleaner (gets shift offers), which needs a phone.
  if (role === "team_leader" && !/^\+[1-9]\d{7,14}$/.test(String(phone ?? ""))) {
    return json({ error: "a valid phone with country code is required for a team leader" }, 400);
  }

  // Invite (NOT createUser): no password is set, email is unconfirmed, so the
  // user can't sign in until they accept the invite and choose a password.
  const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
    data: { full_name: full_name ?? "", role },
    redirectTo,
  });
  if (error) return json({ error: error.message }, 400);

  // New users start as 'invite_sent' until they accept (handle_new_user defaults
  // the profile to 'active'); keep is_active true so they can sign in on accept.
  if (data.user) {
    await sb.from("profiles").update({ status: "invite_sent" }).eq("id", data.user.id);
  }

  // A team leader is the "+1" — mirror them into the cleaners roster so they get
  // shift offers. Match on email: tag the existing cleaner, or create a new one.
  if (role === "team_leader") {
    const lowerEmail = String(email).toLowerCase();
    const { data: existing } = await sb.from("cleaners").select("id").eq("email", lowerEmail).maybeSingle();
    const { error: clErr } = existing
      ? await sb.from("cleaners").update({ is_team_leader: true, is_active: true, status: "active" }).eq("id", existing.id)
      : await sb.from("cleaners").insert({ full_name: full_name ?? email, phone, email: lowerEmail, tier: "tier_1", is_team_leader: true, status: "active" });
    if (clErr) console.error(`[provision-user] cleaner mirror failed: ${clErr.message}`);
  }

  await writeAuditLog(sb, {
    event_type: "user.invited",
    event_label: "User Invited",
    status: "success",
    summary: `New user invited: ${email} as ${ROLE_WORD[role] ?? role}.`,
    detail: { user_id: data.user?.id, role, by: caller.userId },
    source: "provision-user",
    triggered_by: "manual",
  });

  return json({ ok: true, userId: data.user?.id });
});

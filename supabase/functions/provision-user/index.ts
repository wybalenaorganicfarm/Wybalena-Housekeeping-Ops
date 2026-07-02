// provision-user — app-facing. Julian (super_admin ONLY) invites an app user.
// Uses the invite flow: the user receives an email invitation and CANNOT log in
// until they accept it and set their own password. Role/full_name are carried in
// user metadata; the handle_new_user trigger then creates the profile (Spec §7.3).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const VALID_ROLES = ["super_admin", "admin", "team_leader"];
const ROLE_WORD: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", team_leader: "Team Leader" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  // Admin + super_admin have full user management.
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { email, full_name, role, phone, redirectTo } = await req.json().catch(() => ({}));
  if (!email || !role) return json({ error: "email, role required" }, 400);
  if (!VALID_ROLES.includes(role)) return json({ error: "invalid role" }, 400);
  // Only a super_admin may mint another super_admin (the hard-coded owner role).
  if (role === "super_admin" && caller.role !== "super_admin") return json({ error: "forbidden" }, 403);
  // A team leader's phone is used for the manager WhatsApp summary.
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
  // A team leader is NOT a cleaner — their phone (for the manager WhatsApp
  // summary) lives on the profile, not the cleaners roster.
  if (data.user) {
    const patch: Record<string, unknown> = { status: "invite_sent" };
    if (role === "team_leader") patch.phone = phone;
    await sb.from("profiles").update(patch).eq("id", data.user.id);
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

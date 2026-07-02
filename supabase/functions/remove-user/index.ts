// remove-user — app-facing. Julian (super_admin ONLY) removes an app user.
// Notifies the user by email, then deletes the auth user (profiles cascades).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const ROLE_WORD: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", team_leader: "Team Leader" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return json({ error: "userId required" }, 400);
  if (userId === caller.userId) return json({ error: "you cannot remove yourself" }, 400);

  const { data: target } = await sb
    .from("profiles").select("email, full_name, role").eq("id", userId).maybeSingle();
  if (!target) return json({ error: "user not found" }, 404);
  if (target.role === "super_admin") return json({ error: "the Super Admin cannot be removed" }, 400);

  // Notify the user — must never block removal.
  let emailed = false;
  try {
    const r = await sendEmail(
      "Your Wybalena Operations access has been removed",
      `Hi ${target.full_name || "there"},\n\nYour access to the Wybalena Housekeeping Operations system has been removed. You will no longer be able to sign in.\n\nIf you believe this was a mistake, please contact Julian.\n\n— The Wybalena operations team`,
      target.email,
    );
    emailed = r.ok;
  } catch (e) {
    console.error(`[remove-user] email notify failed: ${e}`);
  }

  // A team leader is mirrored in the cleaners roster — remove that too. Clear the
  // shift-assignment history first (FK is on delete restrict) so the cleaner can
  // be hard-deleted, not just deactivated.
  if (target.role === "team_leader" && target.email) {
    const { data: cl } = await sb.from("cleaners").select("id").eq("email", target.email.toLowerCase()).maybeSingle();
    if (cl) {
      await sb.from("shift_assignments").delete().eq("cleaner_id", cl.id);
      const { error: delErr } = await sb.from("cleaners").delete().eq("id", cl.id);
      if (delErr) await sb.from("cleaners").update({ is_active: false, status: "inactive" }).eq("id", cl.id);
    }
  }

  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 400);

  await writeAuditLog(sb, {
    event_type: "user.removed",
    event_label: "User Removed",
    status: "success",
    summary: `User removed: ${target.full_name || target.email} (${ROLE_WORD[target.role] ?? target.role}).`,
    detail: { user_id: userId, role: target.role, by: caller.userId },
    source: "remove-user",
    triggered_by: "manual",
  });

  return json({ ok: true, emailed });
});

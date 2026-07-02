// set-user-role — app-facing (admin / operations_manager). Changes a user's role.
// Uses the service role so profiles can be updated regardless of the caller's RLS.
// Only one operations_manager is expected (they receive all system emails), but we
// don't enforce uniqueness — the most recently-created one wins in opsManager().
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const VALID = ["admin", "operations_manager", "team_leader"];
const ROLE_WORD: Record<string, string> = {
  admin: "Admin",
  operations_manager: "Operations Manager",
  team_leader: "Team Leader",
};

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { userId, role } = await req.json().catch(() => ({}));
  if (!userId || !VALID.includes(role)) return json({ error: "userId and a valid role are required" }, 400);

  const { data: target, error: loadErr } = await sb
    .from("profiles").select("id, full_name, email, role").eq("id", userId).maybeSingle();
  if (loadErr) return json({ error: loadErr.message }, 400);
  if (!target) return json({ error: "user not found" }, 404);

  const { error } = await sb.from("profiles").update({ role }).eq("id", userId);
  if (error) return json({ error: error.message }, 400);

  const { data: me } = await sb.from("profiles").select("full_name").eq("id", caller.userId).maybeSingle();
  const who = me?.full_name ?? "An admin";
  await writeAuditLog(sb, {
    event_type: "user.role_changed",
    event_label: "User Role Changed",
    status: "success",
    summary: `${who} changed ${target.full_name || target.email}'s role to ${ROLE_WORD[role] ?? role}.`,
    detail: { user_id: userId, from: target.role, to: role, by: caller.userId },
    source: "set-user-role",
    triggered_by: "manual",
  });

  return json({ ok: true });
});

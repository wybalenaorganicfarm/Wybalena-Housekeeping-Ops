// set-cleaner-status — app-facing (admin/super_admin). Sets a cleaner's status
// and keeps is_active in sync (active only). If the cleaner is a team leader,
// mirrors the status onto their matching app user (profiles), which admins can't
// write directly under RLS — hence the service role here.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const VALID = ["active", "away", "inactive"];
const STATUS_WORD: Record<string, string> = { active: "Active", away: "Away", inactive: "Inactive" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { cleanerId, status } = await req.json().catch(() => ({}));
  if (!cleanerId || !VALID.includes(status)) return json({ error: "cleanerId and a valid status are required" }, 400);

  const { data: cleaner, error: loadErr } = await sb
    .from("cleaners").select("id, full_name, email, is_team_leader").eq("id", cleanerId).maybeSingle();
  if (loadErr) return json({ error: loadErr.message }, 400);
  if (!cleaner) return json({ error: "cleaner not found" }, 404);

  const { error } = await sb.from("cleaners")
    .update({ status, is_active: status === "active" }).eq("id", cleanerId);
  if (error) return json({ error: error.message }, 400);

  await writeAuditLog(sb, {
    event_type: "cleaner.status_changed",
    event_label: "Cleaner Status Changed",
    status: "success",
    summary: `${cleaner.full_name}'s status changed to ${STATUS_WORD[status] ?? status}.`,
    detail: { cleaner_id: cleanerId, status, by: caller.userId },
    source: "set-cleaner-status",
    cleaner_id: cleanerId,
    triggered_by: "manual",
  });

  // Two-way sync: a team leader's user account mirrors the same status.
  if (cleaner.is_team_leader && cleaner.email) {
    await sb.from("profiles")
      .update({ status, is_active: status !== "inactive" })
      .eq("email", cleaner.email.toLowerCase())
      .neq("status", "invite_sent"); // don't override a pending invite
  }

  return json({ ok: true });
});

// activate-self — called right after an invited user sets their password.
// Flips their own profile from 'invite_sent' to 'active'. The user can't update
// their own profile under RLS, so this runs with the service role.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller) return json({ error: "unauthorized" }, 401);

  const { data: activated } = await sb.from("profiles")
    .update({ status: "active" })
    .eq("id", caller.userId)
    .eq("status", "invite_sent")
    .select("email");

  // Only log a genuine activation (the invite -> active flip), not repeat calls.
  if ((activated ?? []).length > 0) {
    await writeAuditLog(sb, {
      event_type: "user.activated",
      event_label: "Account Activated",
      status: "success",
      summary: `${activated![0].email ?? "A new user"} accepted their invite and activated their account.`,
      detail: { user_id: caller.userId },
      source: "activate-self",
      triggered_by: "system",
    });
  }

  return json({ ok: true });
});

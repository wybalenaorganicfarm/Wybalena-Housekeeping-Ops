// remove-cleaner — app-facing. An ops manager (admin/super_admin) removes a
// cleaner from the roster. The cleaner is notified by email, then deleted.
// If they have shift-assignment history (FK on delete restrict), we cannot hard
// delete without destroying that history, so we deactivate instead.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { cleanerId } = await req.json().catch(() => ({}));
  if (!cleanerId) return json({ error: "cleanerId required" }, 400);

  const { data: cleaner, error: loadErr } = await sb
    .from("cleaners").select("id, full_name, email, is_team_leader").eq("id", cleanerId).maybeSingle();
  if (loadErr) return json({ error: loadErr.message }, 400);
  if (!cleaner) return json({ error: "cleaner not found" }, 404);
  if (cleaner.is_team_leader) return json({ error: "the team leader cannot be removed" }, 400);

  // Notify the cleaner (stubbed until Gmail creds are set; skipped if no email).
  // A notification failure must NEVER block removal.
  let emailed = false;
  if (cleaner.email) {
    try {
      const r = await sendEmail(
        "You have been removed from the Wybalena cleaning roster",
        `Hi ${cleaner.full_name},\n\nThis is to let you know that your profile has been removed from the Wybalena cleaning roster. You will no longer receive shift offers.\n\nIf you believe this was a mistake, please contact the Wybalena operations team.\n\nThank you for your work.`,
        cleaner.email,
      );
      emailed = r.ok;
    } catch (e) {
      console.error(`[remove-cleaner] email notify failed: ${e}`);
    }
  }

  // Clear shift-assignment history first (FK is on delete restrict) so the
  // cleaner is actually deleted, not just deactivated.
  await sb.from("shift_assignments").delete().eq("cleaner_id", cleanerId);
  const { error: delErr } = await sb.from("cleaners").delete().eq("id", cleanerId);
  // NOTE: no cleaner_id on these logs — the row is deleted (FK would null it) or
  // about to be; the name is carried in the summary instead.
  if (delErr) {
    const { error: deactErr } = await sb
      .from("cleaners").update({ is_active: false, status: "inactive" }).eq("id", cleanerId);
    if (deactErr) return json({ error: deactErr.message }, 400);
    await writeAuditLog(sb, {
      event_type: "cleaner.removed",
      event_label: "Cleaner Removed",
      status: "success",
      summary: `Cleaner deactivated (has shift history): ${cleaner.full_name}.`,
      detail: { cleaner_id: cleanerId, mode: "deactivated", by: caller.userId },
      source: "remove-cleaner",
      triggered_by: "manual",
    });
    return json({ ok: true, mode: "deactivated", emailed });
  }

  await writeAuditLog(sb, {
    event_type: "cleaner.removed",
    event_label: "Cleaner Removed",
    status: "success",
    summary: `Cleaner removed from the roster: ${cleaner.full_name}.`,
    detail: { cleaner_id: cleanerId, mode: "deleted", by: caller.userId },
    source: "remove-cleaner",
    triggered_by: "manual",
  });
  return json({ ok: true, mode: "deleted", emailed });
});

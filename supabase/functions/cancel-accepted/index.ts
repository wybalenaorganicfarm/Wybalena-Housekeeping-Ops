// cancel-accepted — app-facing. An admin takes an ACCEPTED cleaner off a shift
// from the Assign-manually modal (distinct from cancelling the whole shift).
// Routes through engine.cancelOffer, which frees the slot and — critically —
// reopens a fully_staffed shift back to staffing with current_tier restored, then
// re-offers / waits as the tier chain dictates. Best-effort "taken off shift"
// message; the removal commits regardless. Caller must be admin or super_admin.
//
// The team_lead guard lives HERE (not in cancelOffer, which whatsapp-inbound also
// uses): refuse a team_lead reservation row except on wipeover, where she's a
// working cleaner. Guard at both layers — the modal hides it, the endpoint refuses.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { cancelOffer } from "../_shared/engine.ts";
import { notifyCleaner } from "../_shared/notifyCleaner.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { assignmentId } = await req.json().catch(() => ({}));
  if (!assignmentId) return json({ error: "assignmentId required" }, 400);

  // Load row + status BEFORE delegating, for the team_lead guard, the message,
  // and the audit line.
  const { data: a } = await sb
    .from("shift_assignments").select("shift_id, cleaner_id, status").eq("id", assignmentId).maybeSingle();
  if (!a) return json({ error: "assignment not found" }, 404);

  // Only an accepted cleaner can be "taken off the shift" here.
  if (a.status !== "accepted") {
    return json({ error: "that cleaner is not currently on this shift" }, 409);
  }

  // team_lead guard — except on wipeover. (An accepted status above already rules
  // out a team_lead reservation row, which is status='team_lead'; this is the
  // belt-and-braces check on the cleaner's flag for the wipeover boundary.)
  const { data: sh } = await sb
    .from("shifts").select("shift_date, shift_type").eq("id", a.shift_id).maybeSingle();
  const { data: cl } = await sb
    .from("cleaners").select("full_name, is_team_leader").eq("id", a.cleaner_id).maybeSingle();
  if (cl?.is_team_leader && sh?.shift_type !== "wipeover") {
    return json({ error: "the Cleaning Manager can't be removed from a shift here" }, 400);
  }

  const outcome = await cancelOffer(sb, assignmentId);
  if (outcome === "closed") {
    return json({ error: "could not remove — the shift or assignment is no longer active" }, 409);
  }

  // Notify best-effort (removal already committed inside cancelOffer).
  const notified = await notifyCleaner(
    sb, a.cleaner_id, "removed_from_shift",
    `You've been taken off the ${prettyDate(sh?.shift_date)} shift.`,
    sh?.shift_date,
  );

  await writeAuditLog(sb, {
    event_type: "assignment.removed",
    event_label: "Cleaner Removed From Shift",
    status: "success",
    summary: `${cl?.full_name ?? "A cleaner"} was taken off the ${sh?.shift_date ? prettyDate(sh.shift_date) : "—"} shift (${outcome}).` +
      (notified ? "" : " (No message sent.)"),
    detail: { assignment_id: assignmentId, shift_id: a.shift_id, cleaner_id: a.cleaner_id, outcome, notified, by: caller.userId },
    source: "cancel-accepted",
    shift_id: a.shift_id,
    cleaner_id: a.cleaner_id,
    triggered_by: "manual",
  });

  return json({ ok: true, outcome, notified });
});

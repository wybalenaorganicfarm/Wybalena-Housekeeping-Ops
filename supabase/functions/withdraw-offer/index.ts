// withdraw-offer — app-facing. An admin retracts an UNACCEPTED offer from the
// Assign-manually modal. Routes through engine.withdrawOffer, which refuses an
// accepted row (use cancel-accepted instead) and a team_lead row except on
// wipeover. Best-effort "offer no longer available" message; the withdrawal
// commits regardless. Caller must be admin or super_admin.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { withdrawOffer } from "../_shared/engine.ts";
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

  // Read shift/cleaner context BEFORE the write, for the message + audit line.
  const { data: a } = await sb
    .from("shift_assignments").select("shift_id, cleaner_id").eq("id", assignmentId).maybeSingle();

  const outcome = await withdrawOffer(sb, assignmentId);

  if (outcome === "accepted") {
    return json({ error: "that cleaner has already accepted — use Remove from shift instead" }, 409);
  }
  if (outcome === "team_lead") {
    return json({ error: "the Cleaning Manager's roster slot can't be withdrawn here" }, 400);
  }
  if (outcome === "closed") {
    return json({ error: "no open offer to withdraw" }, 404);
  }

  // outcome === "withdrawn": notify best-effort, then audit.
  let notified = false;
  let shiftDate: string | null = null;
  if (a) {
    const { data: sh } = await sb.from("shifts").select("shift_date").eq("id", a.shift_id).maybeSingle();
    shiftDate = sh?.shift_date ?? null;
    notified = await notifyCleaner(
      sb, a.cleaner_id, "offer_withdrawn",
      `This offer for the ${prettyDate(shiftDate)} shift is no longer available.`,
      shiftDate,
    );
  }
  const { data: cl } = a
    ? await sb.from("cleaners").select("full_name").eq("id", a.cleaner_id).maybeSingle()
    : { data: null };

  await writeAuditLog(sb, {
    event_type: "assignment.withdrawn",
    event_label: "Offer Withdrawn",
    status: "success",
    summary: `Offer to ${cl?.full_name ?? "a cleaner"} for the ${shiftDate ? prettyDate(shiftDate) : "—"} shift was withdrawn.` +
      (notified ? "" : " (No message sent.)"),
    detail: { assignment_id: assignmentId, shift_id: a?.shift_id, cleaner_id: a?.cleaner_id, notified, by: caller.userId },
    source: "withdraw-offer",
    shift_id: a?.shift_id,
    cleaner_id: a?.cleaner_id,
    triggered_by: "manual",
  });

  return json({ ok: true, notified });
});

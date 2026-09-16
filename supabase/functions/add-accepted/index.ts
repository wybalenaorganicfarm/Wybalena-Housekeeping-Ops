// add-accepted — app-facing. An admin adds a cleaner to a shift as ACCEPTED
// without sending an offer, from the Assign-manually modal. The accepted write +
// all its guards (shift-row lock, hard block at required_cleaners, team_lead-
// except-wipeover) live in the admin_accept_slot RPC so the count-check and write
// are atomic — the one accepted-write outside claim_shift_slot must not reopen
// the race that lock closes. Then recomputeStaffing flips fully_staffed when met,
// and a best-effort "you're booked" message goes out. Caller must be admin or
// super_admin.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { recomputeStaffing } from "../_shared/engine.ts";
import { notifyCleaner } from "../_shared/notifyCleaner.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { shiftId, cleanerId } = await req.json().catch(() => ({}));
  if (!shiftId || !cleanerId) return json({ error: "shiftId and cleanerId required" }, 400);

  const { data: outcome, error: rpcErr } = await sb.rpc("admin_accept_slot", {
    p_shift_id: shiftId,
    p_cleaner_id: cleanerId,
  });
  if (rpcErr) {
    console.error(`[add-accepted] admin_accept_slot failed: ${rpcErr.message}`);
    return json({ error: "could not add the cleaner — please try again" }, 500);
  }
  const res = (outcome as "accepted" | "full" | "team_lead" | "error" | null) ?? "error";

  if (res === "full") {
    return json({ error: "this shift already has its required cleaners" }, 409);
  }
  if (res === "team_lead") {
    return json({ error: "the Cleaning Manager is already rostered — she can't be added here" }, 400);
  }
  if (res === "error") {
    return json({ error: "could not add (shift not found, cancelled, or cleaner inactive)" }, 400);
  }

  // res === "accepted": recompute staffing (may flip the shift fully_staffed),
  // then notify best-effort.
  await recomputeStaffing(sb, shiftId);

  const { data: sh } = await sb.from("shifts").select("shift_date").eq("id", shiftId).maybeSingle();
  const notified = await notifyCleaner(
    sb, cleanerId, "booked_manually",
    `You've been booked for the ${prettyDate(sh?.shift_date)} shift.`,
    sh?.shift_date,
  );

  const { data: cl } = await sb.from("cleaners").select("full_name").eq("id", cleanerId).maybeSingle();
  await writeAuditLog(sb, {
    event_type: "assignment.manual_accept",
    event_label: "Cleaner Added As Accepted",
    status: "success",
    summary: `${cl?.full_name ?? "A cleaner"} was added to the ${sh?.shift_date ? prettyDate(sh.shift_date) : "—"} shift as accepted (no offer sent).` +
      (notified ? "" : " (No message sent.)"),
    detail: { shift_id: shiftId, cleaner_id: cleanerId, notified, by: caller.userId },
    source: "add-accepted",
    shift_id: shiftId,
    cleaner_id: cleanerId,
    triggered_by: "manual",
  });

  return json({ ok: true, notified });
});

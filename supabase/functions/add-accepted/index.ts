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
import { getCaller, canEditRoster } from "../_shared/authz.ts";
import { recomputeStaffing } from "../_shared/engine.ts";
import { notifyCleaner } from "../_shared/notifyCleaner.ts";
import { notifyLeadRosterChange } from "../_shared/managerSummary.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !canEditRoster(caller.role)) return json({ error: "forbidden" }, 403);

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

  const { data: sh } = await sb.from("shifts")
    .select("shift_date, start_time, shift_type, required_cleaners").eq("id", shiftId).maybeSingle();
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

  // If this manual add is within the final 24h, tell the Cleaning Manager the
  // roster changed (with a link). No-op outside 24h or if the switch is off.
  const { count: acceptedNow } = await sb
    .from("shift_assignments").select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId).eq("status", "accepted");
  await notifyLeadRosterChange(sb, {
    kind: "joined",
    cleanerName: cl?.full_name ?? "A cleaner",
    shiftDate: sh?.shift_date ?? "",
    startTime: sh?.start_time ?? "",
    shiftType: sh?.shift_type,
    shiftId,
    cleanerId,
    remaining: acceptedNow ?? null,
    required: sh?.required_cleaners ?? null,
    source: "add-accepted",
    triggeredBy: "manual",
  });

  return json({ ok: true, notified });
});

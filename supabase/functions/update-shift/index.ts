// update-shift — app-facing. Ashleigh edits a shift's fields from the Edit Shift modal.
// Routed through an Edge Function (not a direct RLS update) so the change is recorded
// in the audit log — audit_logs has no frontend write policy. Caller must be a writer.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { prettyDate, prettyDateTime, prettyTime } from "../_shared/datetime.ts";

// Fields the Edit Shift modal may change — anything else the client sends is ignored.
//
// shift_date is included: a booking that moves to another day has to be editable,
// and before this it was not. The modal offered time, duration, type, cleaners and
// instructions but NOT the date, so a shift on the wrong day could only be deleted
// and rebuilt by hand — losing its link to the booking.
const EDITABLE = ["shift_date", "start_time", "estimated_hours", "shift_type", "required_cleaners", "special_instructions"] as const;

// Cancelling is a status change, not a field edit, so it travels the same path but
// is handled separately below. `status` was previously absent from EDITABLE, which
// is why "Cancel shift" appeared to do nothing at all: the patch was silently
// dropped and the function still answered ok, so the UI reported success while the
// shift stayed exactly as it was.
type ShiftStatus = "cancelled";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { shiftId, patch } = await req.json().catch(() => ({}));
  if (!shiftId || !patch || typeof patch !== "object") {
    return json({ error: "shiftId and patch required" }, 400);
  }

  // Snapshot BEFORE the write so we can tell what actually changed, and tell
  // cleaners who already accepted. Editing a shift under them without a word is
  // worse than not being able to edit it at all.
  const { data: before } = await sb
    .from("shifts").select("shift_date, start_time, status").eq("id", shiftId).maybeSingle();
  if (!before) return json({ error: "shift not found" }, 404);

  const clean: Record<string, unknown> = { is_modified: true };
  for (const k of EDITABLE) {
    if (k in patch) clean[k] = patch[k];
  }

  // Cancelling the shift. Only this one status transition is accepted from the
  // client — every other status is driven by the engine, never by the modal.
  const cancelling = patch.status === "cancelled" && before.status !== "cancelled";
  if (cancelling) {
    clean["status"] = "cancelled" satisfies ShiftStatus;
    clean["cancelled_at"] = new Date().toISOString();
  }

  // Did the shift actually move? Compared against the stored value so re-saving
  // the modal without touching the date notifies nobody.
  const newDate = typeof clean["shift_date"] === "string" ? clean["shift_date"] as string : null;
  const newTime = typeof clean["start_time"] === "string" ? clean["start_time"] as string : null;
  const dateMoved = Boolean(newDate && newDate !== before.shift_date);
  const timeMoved = Boolean(newTime && newTime.slice(0, 5) !== (before.start_time ?? "").slice(0, 5));
  // Record who set the special instructions (and when) so the UI can attribute them.
  if ("special_instructions" in patch) {
    const hasNote = typeof patch.special_instructions === "string" && patch.special_instructions.trim().length > 0;
    clean["special_instructions_by"] = hasNote ? caller.userId : null;
    clean["special_instructions_at"] = hasNote ? new Date().toISOString() : null;
  }

  const { error } = await sb.from("shifts").update(clean).eq("id", shiftId);
  if (error) return json({ error: error.message }, 400);

  const { data: sh } = await sb.from("shifts").select("shift_date, start_time").eq("id", shiftId).maybeSingle();
  const { data: me } = await sb.from("profiles").select("full_name").eq("id", caller.userId).maybeSingle();
  const who = me?.full_name ?? "The admin";

  // Tell the cleaners who are actually on this shift. Anyone still holding an
  // open OFFER is included when it moves: they were asked about a shift on one
  // day and must not answer for a different one.
  const affected = cancelling || dateMoved || timeMoved;
  let notified = 0;
  if (affected) {
    const statuses = cancelling ? ["accepted"] : ["accepted", "offered"];
    const { data: rows } = await sb
      .from("shift_assignments").select("cleaner_id").eq("shift_id", shiftId).in("status", statuses);
    const oldWhen = prettyDateTime(before.shift_date ?? "", (before.start_time ?? "").slice(0, 5));
    const newWhen = prettyDateTime(sh?.shift_date ?? "", (sh?.start_time ?? "").slice(0, 5));
    for (const a of rows ?? []) {
      const { data: cl } = await sb.from("cleaners").select("phone").eq("id", a.cleaner_id).maybeSingle();
      if (!cl?.phone) continue;
      const vars = {
        shift_date: prettyDate(sh?.shift_date ?? ""),
        start_time: prettyTime((sh?.start_time ?? "").slice(0, 5)),
        old_shift_date: prettyDate(before.shift_date ?? ""),
        old_start_time: prettyTime((before.start_time ?? "").slice(0, 5)),
      };
      const body = cancelling
        ? await renderTemplate(sb, "shift_cancelled_by_admin",
            `The shift on ${oldWhen} has been cancelled. No action needed.`, vars)
        : await renderTemplate(sb, "shift_moved_by_admin",
            `The shift you were offered on ${oldWhen} has been moved to ${newWhen}. ` +
            `Your response still stands for the new date — if that no longer suits, please let us know.`, vars);
      await sendMessage(cl.phone, body);
      notified++;
    }
  }

  // A shift that MOVED while cleaners were already committed needs a human to
  // look at it. Everyone affected has been messaged above, but their acceptance
  // was for the old date — someone has to confirm they still hold for the new
  // one. Raise an alert rather than assuming, and dedupe to one open alert per
  // shift so repeated edits don't pile up.
  if ((dateMoved || timeMoved) && !cancelling && notified > 0) {
    const { data: dup } = await sb.from("alerts").select("id")
      .eq("alert_type", "shift_moved").eq("shift_id", shiftId).eq("status", "open").maybeSingle();
    if (!dup) {
      await sb.from("alerts").insert({
        alert_type: "shift_moved",
        shift_id: shiftId,
        title: "Shift date changed",
        body: `${who} moved this shift from ${prettyDateTime(before.shift_date ?? "", (before.start_time ?? "").slice(0, 5))} ` +
          `to ${prettyDateTime(sh?.shift_date ?? "", (sh?.start_time ?? "").slice(0, 5))}. ` +
          `${notified} cleaner(s) were already accepted or offered and have been notified — check they still hold for the new date.`,
      });
    }
  }

  // Cancelling closes the offers too, so the shift stops being chased by the
  // reminder and escalation jobs — without this it stays "offered" forever and
  // keeps being chased for a shift that no longer exists.
  //
  // "no_response" is the engine's own term for an offer closed without a reply
  // (see markFullyStaffed); assignment_status has no "closed" value.
  if (cancelling) {
    await sb.from("shift_assignments")
      .update({ status: "no_response" })
      .eq("shift_id", shiftId)
      .in("status", ["offered", "accepted"]);
  }

  const moveNote = dateMoved || timeMoved
    ? ` Moved from ${prettyDateTime(before.shift_date ?? "", (before.start_time ?? "").slice(0, 5))} to ${prettyDateTime(sh?.shift_date ?? "", (sh?.start_time ?? "").slice(0, 5))}.`
    : "";
  const notifyNote = affected ? ` ${notified} cleaner(s) notified.` : "";

  await writeAuditLog(sb, {
    event_type: cancelling ? "shift.cancelled" : "shift.edited",
    event_label: cancelling ? "Shift Cancelled" : "Shift Edited",
    status: cancelling ? "warning" : "success",
    summary: cancelling
      ? `${who} cancelled the shift on ${prettyDate(before.shift_date ?? "")}. Open offers closed.${notifyNote}`
      : `${who} edited the shift on ${prettyDate(sh?.shift_date ?? "—")}.${moveNote}${notifyNote}`,
    detail: {
      shift_id: shiftId,
      fields: Object.keys(clean).filter((k) => k !== "is_modified"),
      by: caller.userId,
      ...(dateMoved || timeMoved
        ? { moved_from: { shift_date: before.shift_date, start_time: before.start_time }, moved_to: { shift_date: sh?.shift_date, start_time: sh?.start_time } }
        : {}),
      ...(affected ? { cleaners_notified: notified } : {}),
    },
    source: "update-shift",
    shift_id: shiftId,
    triggered_by: "manual",
  });

  return json({ ok: true, cancelled: cancelling, moved: dateMoved || timeMoved, cleanersNotified: notified });
});

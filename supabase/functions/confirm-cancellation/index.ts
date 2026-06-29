// confirm-cancellation — app-facing. Ashley actions a booking_cancelled alert:
// cancel all linked shifts, notify accepted cleaners via WhatsApp, close the
// alert. Caller must be admin or super_admin (Spec §7.3).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { alertId } = await req.json().catch(() => ({}));
  if (!alertId) return json({ error: "alertId required" }, 400);

  const { data: alert } = await sb
    .from("alerts").select("id, booking_id").eq("id", alertId).maybeSingle();
  if (!alert?.booking_id) return json({ error: "alert or linked booking not found" }, 404);

  // Linked shifts for this booking.
  const { data: shifts } = await sb
    .from("shifts").select("id").eq("booking_id", alert.booking_id).neq("status", "cancelled");

  let notified = 0;
  for (const s of shifts ?? []) {
    // Notify accepted cleaners before cancelling.
    const { data: accepted } = await sb
      .from("shift_assignments").select("cleaner_id").eq("shift_id", s.id).eq("status", "accepted");
    for (const a of accepted ?? []) {
      const { data: c } = await sb.from("cleaners").select("phone").eq("id", a.cleaner_id).maybeSingle();
      if (c?.phone) { await sendMessage(c.phone, "A shift you accepted has been cancelled. No action needed."); notified++; }
    }
    await sb.from("shifts")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", s.id);
  }

  await sb.from("alerts")
    .update({ status: "actioned", actioned_by: caller.userId, actioned_at: new Date().toISOString() })
    .eq("id", alertId);

  const cancelledShifts = (shifts ?? []).length;
  await writeAuditLog(sb, {
    event_type: "booking.cancellation_confirmed",
    event_label: "Cancellation Confirmed",
    status: "success",
    summary: `Booking cancellation actioned. ${cancelledShifts} shift(s) cancelled, ${notified} cleaner(s) notified.`,
    detail: { alert_id: alertId, booking_id: alert.booking_id, cancelledShifts, notified, by: caller.userId },
    source: "confirm-cancellation",
    booking_id: alert.booking_id,
    triggered_by: "manual",
  });

  return json({ ok: true, cancelledShifts, cleanersNotified: notified });
});

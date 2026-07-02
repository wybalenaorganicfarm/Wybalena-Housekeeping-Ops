// sync-bookings — cron: Mon 09:00 IST testing (Mon 03:30 UTC); go-live tz TBD.
// Fetches the target booking week (~5 weeks out), dedupes on gcal_event_id,
// stores bookings, creates shift(s) by the >=7-night rule, raises venue-gap
// alerts for >3-day gaps, and detects calendar cancellations (Spec §2, §7.1, §7.2).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { fetchBookings } from "../_shared/adapters/calendar.ts";
import { requiredForType } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { confirmationEmail, type ConfirmShift } from "../_shared/emailTemplates.ts";
import { signShift } from "../_shared/confirmToken.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const DAY = 86400000;
const SOURCE = "sync-bookings";
const SHIFT_LABEL: Record<string, string> = { standard: "Standard Clean", mid_retreat: "Mid-Retreat Clean" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Target week: ~5 weeks out (after a 4-week buffer, excluding current week).
  const now = new Date();
  const timeMin = new Date(now.getTime() + 35 * DAY);
  const timeMax = new Date(timeMin.getTime() + 7 * DAY);

  let events;
  try {
    events = await fetchBookings(timeMin.toISOString(), timeMax.toISOString());
  } catch (e) {
    await writeAuditLog(sb, {
      event_type: "sync.run",
      event_label: "Weekly Booking Sync",
      status: "failed",
      summary: `Booking sync failed. Google Calendar could not be reached. Error: ${String(e)}.`,
      error_message: String(e),
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: false, error: String(e) }, 500);
  }

  const newShiftSummaries: string[] = [];
  const pendingForEmail: ConfirmShift[] = [];
  let createdBookings = 0;
  let createdShifts = 0;
  let cancellations = 0;

  for (const ev of events) {
    if (!ev.gcalEventId) continue;

    const { data: existing } = await sb
      .from("bookings")
      .select("id, is_cancelled")
      .eq("gcal_event_id", ev.gcalEventId)
      .maybeSingle();

    // --- Cancellation detection (does NOT auto-cancel shifts) ---------------
    if (ev.cancelled) {
      if (existing && !existing.is_cancelled) {
        await sb.from("bookings").update({ is_cancelled: true }).eq("id", existing.id);
        await sb.from("alerts").insert({
          alert_type: "booking_cancelled",
          booking_id: existing.id,
          title: "Booking cancelled",
          body: `Calendar event ${ev.gcalEventId} was cancelled. Review linked shifts.`,
        });
        await sendEmail(
          "Wybalena: booking cancelled",
          `A booking was cancelled in the calendar (${ev.gcalEventId}). ` +
            `No shifts have been auto-cancelled — confirm in the app.`,
          (await opsManager(sb)).email ?? undefined,
        );
        cancellations++;
        await writeAuditLog(sb, {
          event_type: "booking.cancellation_detected",
          event_label: "Booking Cancellation Detected",
          status: "success",
          summary: "Booking cancellation detected. Alert sent to Ashley to review.",
          detail: { booking_id: existing.id, gcal_event_id: ev.gcalEventId },
          source: SOURCE,
          booking_id: existing.id,
          triggered_by: "cron",
        });
      }
      continue;
    }

    if (existing) continue; // already in system -> skip (idempotent)

    // --- Store booking ------------------------------------------------------
    const { data: booking } = await sb
      .from("bookings")
      .insert({
        gcal_event_id: ev.gcalEventId,
        guest_name: ev.guestName,
        check_in: ev.checkIn,
        check_out: ev.checkOut,
        nights: ev.nights,
        guest_count: ev.guestCount,
        raw_payload: ev.raw,
      })
      .select("id")
      .single();
    createdBookings++;
    await writeAuditLog(sb, {
      event_type: "booking.created",
      event_label: "Booking Created",
      status: "success",
      summary: `New booking detected: ${ev.guestName ?? "Guest booking"}, ${ev.checkIn.slice(0, 10)} → ${ev.checkOut.slice(0, 10)}.`,
      detail: { booking_id: booking!.id, nights: ev.nights },
      source: SOURCE,
      booking_id: booking!.id,
      triggered_by: "cron",
    });

    // --- Create shift(s): >=7 nights -> standard + mid_retreat, else standard
    const shiftRows = [
      {
        booking_id: booking!.id,
        shift_type: "standard",
        shift_date: ev.checkOut.slice(0, 10),
        start_time: "10:00",
        status: "pending_confirmation",
        source: "auto",
        required_cleaners: requiredForType("standard"),
      },
    ];
    if (ev.nights >= 7) {
      const mid = new Date(new Date(ev.checkIn).getTime() + Math.floor(ev.nights / 2) * DAY);
      shiftRows.push({
        booking_id: booking!.id,
        shift_type: "mid_retreat",
        shift_date: mid.toISOString().slice(0, 10),
        start_time: "10:00",
        status: "pending_confirmation",
        source: "auto",
        required_cleaners: requiredForType("mid_retreat"),
      });
    }
    const { data: insertedShifts } = await sb.from("shifts").insert(shiftRows).select("id, shift_type, shift_date, start_time, required_cleaners");
    createdShifts += (insertedShifts ?? []).length;
    for (const sh of insertedShifts ?? []) {
      pendingForEmail.push({
        id: sh.id,
        shift_type: sh.shift_type,
        shift_date: sh.shift_date,
        start_time: sh.start_time,
        required_cleaners: sh.required_cleaners,
        guest_name: ev.guestName,
        nights: ev.nights,
        check_in: ev.checkIn,
        check_out: ev.checkOut,
      });
      const summary = sh.shift_type === "mid_retreat"
        ? `Mid-Retreat Clean shift created for ${sh.shift_date} (long stay ≥7 nights).`
        : `${SHIFT_LABEL[sh.shift_type] ?? sh.shift_type} shift created for ${sh.shift_date} from ${ev.guestName ?? "guest"}'s booking.`;
      await writeAuditLog(sb, {
        event_type: "shift.created",
        event_label: "Shift Created",
        status: "success",
        summary,
        detail: { shift_id: sh.id, booking_id: booking!.id, shift_type: sh.shift_type },
        source: SOURCE,
        shift_id: sh.id,
        booking_id: booking!.id,
        triggered_by: "cron",
      });
    }
    newShiftSummaries.push(
      `${ev.guestName ?? "Booking"} (${ev.nights}n) -> ${shiftRows.length} shift(s)`,
    );
  }

  // Venue-gap detection + the wipeover-cleaning email now live in their own
  // independently-schedulable function (wipeover-notify), so they're not run here.

  // --- Confirmation email to Ashley: one email, every pending shift, per-shift
  //     Confirm/Edit buttons (Confirm = signed one-click link; Edit = app deep-link).
  if (pendingForEmail.length) {
    const base = Deno.env.get("SUPABASE_URL") ?? "";
    const appUrl = Deno.env.get("APP_URL") ?? "";
    const fmtWeek = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

    const shiftsWithLinks = await Promise.all(
      pendingForEmail.map(async (s) => ({ s, sig: await signShift(s.id) })),
    );
    const linkBySig = new Map(shiftsWithLinks.map(({ s, sig }) => [s.id, sig]));

    const email = confirmationEmail(pendingForEmail, {
      weekFrom: fmtWeek(timeMin),
      weekTo: fmtWeek(timeMax),
      signedLinkFor: (id) => `${base}/functions/v1/confirm-shift-email?shift=${id}&token=${linkBySig.get(id) ?? ""}`,
      editUrlFor: (id) => `${appUrl}/?edit=${id}`,
    });

    const ops = await opsManager(sb);
    const sent = await sendEmail(email.subject, email.text, ops.email ?? undefined, email.html);
    const who = ops.name;
    await writeAuditLog(sb, {
      event_type: "notification.confirmation_email",
      event_label: "Confirmation Email",
      status: sent.ok ? "success" : "failed",
      summary: sent.ok
        ? `Confirmation email sent to ${who} — ${pendingForEmail.length} shift(s) awaiting confirmation.`
        : `Failed to send confirmation email to ${who}. Error: email provider returned an error.`,
      error_message: sent.ok ? undefined : "email provider returned an error",
      detail: { shifts: pendingForEmail.map((s) => `${s.shift_type} · ${s.shift_date}`) },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  // --- Run summary ---------------------------------------------------------
  if (createdBookings === 0 && cancellations === 0) {
    await writeAuditLog(sb, {
      event_type: "sync.run",
      event_label: "Weekly Booking Sync",
      status: "skipped",
      summary: "Weekly booking sync ran. No new bookings found for the target week.",
      source: SOURCE,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "sync.run",
      event_label: "Weekly Booking Sync",
      status: "success",
      summary: `Weekly booking sync completed. ${createdBookings} new booking(s) found, ${createdShifts} shift(s) created.`,
      detail: { createdBookings, createdShifts, cancellations },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, createdBookings, newShifts: newShiftSummaries.length });
});

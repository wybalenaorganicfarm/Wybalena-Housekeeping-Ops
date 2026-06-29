// sync-bookings — cron: Mon 09:00 IST testing (Mon 03:30 UTC); go-live tz TBD.
// Fetches the target booking week (~5 weeks out), dedupes on gcal_event_id,
// stores bookings, creates shift(s) by the >=7-night rule, raises venue-gap
// alerts for >3-day gaps, and detects calendar cancellations (Spec §2, §7.1, §7.2).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { fetchBookings } from "../_shared/adapters/calendar.ts";
import { requiredForType } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
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
  let createdBookings = 0;
  let createdShifts = 0;
  let cancellations = 0;
  let gapsRaised = 0;

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
    const { data: insertedShifts } = await sb.from("shifts").insert(shiftRows).select("id, shift_type, shift_date");
    createdShifts += (insertedShifts ?? []).length;
    for (const sh of insertedShifts ?? []) {
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

  // --- Venue-gap detection: >3 days between consecutive bookings ------------
  const { data: window } = await sb
    .from("bookings")
    .select("id, check_in, check_out, is_cancelled")
    .gte("check_out", timeMin.toISOString())
    .lte("check_in", new Date(timeMax.getTime() + 14 * DAY).toISOString())
    .eq("is_cancelled", false)
    .order("check_in");

  const sorted = window ?? [];
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (new Date(sorted[i].check_in).getTime() -
      new Date(sorted[i - 1].check_out).getTime()) / DAY;
    if (gapDays > 3) {
      const from = sorted[i - 1].check_out.slice(0, 10);
      const to = sorted[i].check_in.slice(0, 10);
      const title = "Venue gap > 3 days";
      const body = `No clean scheduled between ${from} and ${to}. Plan an extra clean?`;
      const { data: dup } = await sb
        .from("alerts")
        .select("id")
        .eq("alert_type", "venue_gap")
        .eq("status", "open")
        .eq("body", body)
        .maybeSingle();
      if (!dup) {
        await sb.from("alerts").insert({ alert_type: "venue_gap", title, body });
        gapsRaised++;
        await writeAuditLog(sb, {
          event_type: "alert.raised",
          event_label: "Venue Gap Alert",
          status: "success",
          summary: `Venue gap alert raised: gap of ${Math.round(gapDays)} days between ${from} and ${to}. Ashley notified.`,
          detail: { from, to, gap_days: Math.round(gapDays) },
          source: SOURCE,
          triggered_by: "cron",
        });
      }
    }
  }

  // --- Summary email to Ashley ---------------------------------------------
  if (newShiftSummaries.length) {
    await sendEmail(
      `Wybalena: ${newShiftSummaries.length} new booking(s) need confirming`,
      `New shifts were auto-created and are pending your confirmation:\n\n` +
        newShiftSummaries.map((s) => ` • ${s}`).join("\n"),
    );
  }

  // --- Run summary ---------------------------------------------------------
  if (createdBookings === 0 && cancellations === 0 && gapsRaised === 0) {
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
      detail: { createdBookings, createdShifts, cancellations, gapsRaised },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, createdBookings, newShifts: newShiftSummaries.length });
});

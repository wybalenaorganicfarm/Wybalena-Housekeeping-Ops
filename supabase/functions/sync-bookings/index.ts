// sync-bookings — cron: schedule is admin-editable from /schedule; go-live tz TBD.
// The target window is anchored to whichever weekday the job runs on, so changing
// the schedule shifts the window with it. How far ahead it starts (lead weeks)
// and how long it runs (window days) are admin-editable from /schedule too —
// stored in app_settings, defaulting to the original 5 weeks / 7 days.
// Fetches the target booking window, dedupes on gcal_event_id,
// stores bookings, creates shift(s) by the >=7-night rule, raises venue-gap
// alerts for >3-day gaps, and detects calendar cancellations (Spec §2, §7.1, §7.2).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { fetchBookings } from "../_shared/adapters/calendar.ts";
import { requiredForType } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { confirmationEmail, midRetreatEmail, type ConfirmShift } from "../_shared/emailTemplates.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { signShift } from "../_shared/confirmToken.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { loadBookingSyncRange } from "../_shared/settings.ts";

const DAY = 86400000;
const SOURCE = "sync-bookings";
const SHIFT_LABEL: Record<string, string> = { standard: "Standard Clean", mid_retreat: "Mid-Retreat Clean" };
// A stay this long needs a mid-retreat clean part-way through. The shift is NOT
// created automatically — the Operations Manager is notified and schedules it.
const MID_RETREAT_MIN_NIGHTS = 7;

// The venue's calendar day (Australia/Sydney, DST-aware) — the only day boundary
// that matters here. Supabase runs UTC regardless of project region, and Sydney is
// +10/+11, so a 09:00 local check-out is the PREVIOUS day in UTC. Comparing on
// absolute instants would file that clean into the wrong week; comparing on the
// local date string can't. Same idiom as pre-shift-reminder.
function localDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d); // YYYY-MM-DD
}

// Human label for the email header, from a YYYY-MM-DD venue-local date.
function fmtWeek(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Target window: `leadWeeks` ahead, covering `windowDays` (default 5 weeks /
  // 7 days — the long-standing behaviour). A true N-day block on VENUE-LOCAL
  // dates, anchored on whichever weekday the job is scheduled for: `fromDate`
  // is included, `toDate` (lead + window) is excluded. Run a 7-day window on a
  // Wednesday and it covers Wed→Tue, excluding the next Wednesday.
  const { leadWeeks, windowDays } = await loadBookingSyncRange(sb);
  const leadDays = leadWeeks * 7;
  const now = new Date();
  const fromDate = localDateStr(new Date(now.getTime() + leadDays * DAY));                    // inclusive
  const toDate = localDateStr(new Date(now.getTime() + (leadDays + windowDays) * DAY));       // EXCLUSIVE
  const lastDate = localDateStr(new Date(now.getTime() + (leadDays + windowDays - 1) * DAY)); // last day covered

  // The Google query is only a coarse prefilter — padded a day either side so no
  // local-date edge case is dropped before the authoritative check below.
  const fetchMin = new Date(now.getTime() + (leadDays - 1) * DAY);
  const fetchMax = new Date(now.getTime() + (leadDays + windowDays + 1) * DAY);

  let events;
  try {
    events = await fetchBookings(fetchMin.toISOString(), fetchMax.toISOString());
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
  // Long stays whose mid-retreat clean the manager must schedule by hand.
  const midRetreatNeeded: { booking: typeof events[number]; bookingId: string; suggestedDate: string }[] = [];
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
          summary: "Booking cancellation detected. Alert sent to Ashleigh to review.",
          detail: { booking_id: existing.id, gcal_event_id: ev.gcalEventId },
          source: SOURCE,
          booking_id: existing.id,
          triggered_by: "cron",
        });
      }
      continue;
    }

    // --- Store booking on first sight (independent of the shift window) ------
    // The booking belongs to whichever week it appears in the calendar; the
    // clean/shift is a separate concern, gated on check-out below.
    let bookingId: string;
    if (existing) {
      bookingId = existing.id;
    } else {
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
      bookingId = booking!.id;
      createdBookings++;
      await writeAuditLog(sb, {
        event_type: "booking.created",
        event_label: "Booking Created",
        status: "success",
        summary: `New booking detected: ${ev.guestName ?? "Guest booking"}, ${ev.checkIn.slice(0, 10)} → ${ev.checkOut.slice(0, 10)}.`,
        detail: { booking_id: bookingId, nights: ev.nights },
        source: SOURCE,
        booking_id: bookingId,
        triggered_by: "cron",
      });
    }

    // --- Gate the clean on CHECK-OUT falling inside the target week ----------
    // Google returns events that merely OVERLAP the window, so a stay that
    // starts this week but checks out later (e.g. 19 Aug → 23 Aug) is stored as
    // a booking now, but its clean is created by the run whose window contains
    // the check-out date (next week).
    // Venue-local check-out date — also the clean's date, so the week gate and
    // shift_date can never disagree (they could when one used the raw string and
    // the other an absolute instant).
    const checkOutDate = localDateStr(new Date(ev.checkOut));
    if (checkOutDate < fromDate || checkOutDate >= toDate) continue;

    // Idempotent per booking: a later run must not duplicate a shift an earlier
    // run already created for this booking.
    const { data: existingShifts } = await sb
      .from("shifts")
      .select("id")
      .eq("booking_id", bookingId);
    if (existingShifts && existingShifts.length) continue;

    // --- Create the checkout clean. Long stays (>=7 nights) ALSO need a
    // mid-retreat clean, but that one is no longer created automatically: its
    // date and crew are a judgement call, so the Operations Manager is notified
    // (email + WhatsApp, like the wipeover notice) and schedules it by hand.
    const shiftRows = [
      {
        booking_id: bookingId,
        shift_type: "standard",
        shift_date: checkOutDate,
        start_time: "10:00",
        status: "pending_confirmation",
        source: "auto",
        required_cleaners: requiredForType("standard"),
      },
    ];
    if (ev.nights >= MID_RETREAT_MIN_NIGHTS) {
      const mid = new Date(new Date(ev.checkIn).getTime() + Math.floor(ev.nights / 2) * DAY);
      midRetreatNeeded.push({ booking: ev, bookingId, suggestedDate: localDateStr(mid) });
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
        detail: { shift_id: sh.id, booking_id: bookingId, shift_type: sh.shift_type },
        source: SOURCE,
        shift_id: sh.id,
        booking_id: bookingId,
        triggered_by: "cron",
      });
    }
    newShiftSummaries.push(
      `${ev.guestName ?? "Booking"} (${ev.nights}n) -> ${shiftRows.length} shift(s)`,
    );
  }

  // Venue-gap detection + the wipeover-cleaning email now live in their own
  // independently-schedulable function (wipeover-notify), so they're not run here.

  // --- Confirmation email to Ashleigh: one email, every pending shift, per-shift
  //     Confirm/Edit buttons (Confirm = signed one-click link; Edit = app deep-link).
  if (pendingForEmail.length) {
    const base = Deno.env.get("SUPABASE_URL") ?? "";
    const appUrl = Deno.env.get("APP_URL") ?? "";

    const shiftsWithLinks = await Promise.all(
      pendingForEmail.map(async (s) => ({ s, sig: await signShift(s.id) })),
    );
    const linkBySig = new Map(shiftsWithLinks.map(({ s, sig }) => [s.id, sig]));

    const email = confirmationEmail(pendingForEmail, {
      weekFrom: fmtWeek(fromDate),
      // `toDate` is exclusive — label the last day actually covered, so a Monday
      // run reads "Mon → Sun" rather than "Mon → Mon".
      weekTo: fmtWeek(lastDate),
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

  // --- Mid-retreat notices ---------------------------------------------------
  // The shifts themselves are deliberately NOT created (see above) — this tells
  // the Operations Manager to schedule them. One ALERT per booking (so each can
  // be actioned and dismissed on its own), but ONE email and ONE WhatsApp for
  // the whole run: several long stays in a roster must not mean several
  // near-identical messages to work through.
  let midRetreatNotified = 0;
  if (midRetreatNeeded.length) {
    const ops = await opsManager(sb);
    const fresh: typeof midRetreatNeeded = [];

    // Skip any booking that already has an open notice — a re-run must not
    // re-alert or re-email for one it has already flagged.
    for (const item of midRetreatNeeded) {
      const { data: dup } = await sb
        .from("alerts")
        .select("id")
        .eq("alert_type", "mid_retreat_needed")
        .eq("status", "open")
        .eq("booking_id", item.bookingId)
        .maybeSingle();
      if (dup) continue;

      await sb.from("alerts").insert({
        alert_type: "mid_retreat_needed",
        booking_id: item.bookingId,
        title: "Mid-retreat clean needed",
        body: `${item.booking.guestName ?? "A booking"} is ${item.booking.nights} nights — a mid-retreat clean is needed around ${prettyDate(item.suggestedDate)}. Create the shift manually.`,
      });
      fresh.push(item);
    }

    if (fresh.length) {
      midRetreatNotified = fresh.length;

      const mail = midRetreatEmail(fresh.map(({ booking: ev, suggestedDate }) => ({
        booking: { guest_name: ev.guestName, gcal_event_id: ev.gcalEventId, check_in: ev.checkIn, check_out: ev.checkOut },
        nights: ev.nights,
        suggestedDate: prettyDate(suggestedDate),
      })));
      const sent = await sendEmail(mail.subject, mail.text, ops.email ?? undefined, mail.html);

      // The same digest on WhatsApp. A missing manager phone is not a failure —
      // the email and the alerts already carry it.
      const many = fresh.length > 1;
      const bookingList = fresh.map(({ booking: ev, suggestedDate }) =>
        `• ${ev.guestName ?? "A booking"} — ${ev.nights} nights\n` +
        `  📅 ${prettyDate(localDateStr(new Date(ev.checkIn)))} → ${prettyDate(localDateStr(new Date(ev.checkOut)))}\n` +
        `  ⏰ Suggested mid-stay date: ${prettyDate(suggestedDate)}`).join("\n\n");
      const waText = await renderTemplate(sb, "mid_retreat_whatsapp",
        `🧹 *Mid-Retreat Clean${many ? "s" : ""} Required*\n\n` +
        (many ? `${fresh.length} bookings in this roster are 7 nights or longer:\n\n` : "") +
        bookingList +
        `\n\n${many ? "These shifts are" : "This shift is"} not created automatically — please add ${many ? "them" : "it"} from the Shifts page.`,
        { booking_list: bookingList, count: fresh.length });
      const waSent = ops.phone ? await sendMessage(ops.phone, waText) : null;

      const waWord = waSent === null ? "skipped (no manager phone)" : waSent.ok ? "sent" : "failed";
      await writeAuditLog(sb, {
        event_type: "mid_retreat.notified",
        event_label: "Mid-Retreat Clean",
        status: sent.ok ? "success" : "failed",
        summary:
          `${fresh.length} mid-retreat clean(s) need scheduling: ` +
          fresh.map(({ booking: ev, suggestedDate }) => `${ev.guestName ?? "a booking"} (${ev.nights}n, suggested ${suggestedDate})`).join("; ") +
          `. Alert(s) raised. Email ${sent.ok ? "sent" : "failed"}; WhatsApp ${waWord}.`,
        error_message: sent.ok ? undefined : "email provider returned an error",
        detail: {
          count: fresh.length,
          bookings: fresh.map(({ booking: ev, bookingId, suggestedDate }) =>
            ({ booking_id: bookingId, guest: ev.guestName, nights: ev.nights, suggested_date: suggestedDate })),
          emailed: sent.ok,
          whatsapped: waSent?.ok ?? false,
        },
        source: SOURCE,
        triggered_by: "cron",
      });
    }
  }

  // --- Run summary ---------------------------------------------------------
  if (createdBookings === 0 && cancellations === 0) {
    await writeAuditLog(sb, {
      event_type: "sync.run",
      event_label: "Weekly Booking Sync",
      status: "skipped",
      summary: `Weekly booking sync ran. No new bookings found for ${fmtWeek(fromDate)} – ${fmtWeek(lastDate)}.`,
      detail: { leadWeeks, windowDays, from: fromDate, to: lastDate },
      source: SOURCE,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "sync.run",
      event_label: "Weekly Booking Sync",
      status: "success",
      summary: `Weekly booking sync completed. ${createdBookings} new booking(s) found, ${createdShifts} shift(s) created`
        + (midRetreatNotified ? `, ${midRetreatNotified} mid-retreat clean(s) flagged for manual scheduling.` : "."),
      detail: { createdBookings, createdShifts, cancellations, midRetreatNotified, leadWeeks, windowDays, from: fromDate, to: lastDate },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, createdBookings, newShifts: newShiftSummaries.length });
});

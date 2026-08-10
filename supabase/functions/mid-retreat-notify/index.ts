// mid-retreat-notify — cron. Scans upcoming bookings for long stays (>= 7 nights)
// whose mid-retreat clean has not been scheduled yet, raises a mid_retreat_needed
// alert per booking, and sends the Operations Manager ONE email + ONE WhatsApp
// digest for the run. Independently schedulable from the /schedule page — the
// same shape as wipeover-notify.
//
// Why this is its own job rather than a step inside sync-bookings (where it used
// to live): the sync only considers bookings whose CHECK-OUT falls in the target
// week, and skips any booking that already has a shift. A long stay outside that
// week — or one already carrying its checkout clean — was therefore never
// flagged. This scans every upcoming booking on each run instead, so a stay is
// picked up whenever it qualifies.
//
// Notify-once semantics: a booking is skipped when it already carries a
// mid_retreat_needed alert in ANY status (open, actioned or dismissed — the
// manager has seen it) or already has a mid_retreat shift on the books.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { midRetreatEmail } from "../_shared/emailTemplates.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { prettyDate } from "../_shared/datetime.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const DAY = 86400000;
const SOURCE = "mid-retreat-notify";
// A stay this long needs a clean part-way through. The shift is NOT created
// automatically — its date and crew are a judgement call, so the Operations
// Manager is notified and schedules it by hand from the Shifts page.
const MID_RETREAT_MIN_NIGHTS = 7;

// The venue's calendar day (Australia/Sydney, DST-aware). Supabase runs UTC
// regardless of project region and Sydney is +10/+11, so a 09:00 local check-out
// is the PREVIOUS day in UTC — the suggested date must be computed on local
// dates or it lands a day out. Same idiom as sync-bookings.
function localDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d); // YYYY-MM-DD
}

interface Booking {
  id: string;
  gcal_event_id: string | null;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  nights: number;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  // Every upcoming, non-cancelled long stay (from the start of today), in date
  // order. Bookings only reach the table via the sync's look-ahead window, so
  // this is naturally bounded to the near term without a second date filter.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: bookings, error } = await sb
    .from("bookings")
    .select("id, gcal_event_id, guest_name, check_in, check_out, nights")
    .gte("check_out", todayStart.toISOString())
    .eq("is_cancelled", false)
    .gte("nights", MID_RETREAT_MIN_NIGHTS)
    .order("check_in");

  if (error) {
    await writeAuditLog(sb, {
      event_type: "mid_retreat.run",
      event_label: "Mid-Retreat Clean",
      status: "failed",
      summary: `Mid-retreat check failed — the bookings could not be read. Error: ${error.message}.`,
      error_message: error.message,
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: false, error: error.message }, 500);
  }

  const ops = await opsManager(sb);
  const fresh: { booking: Booking; suggestedDate: string }[] = [];

  for (const b of (bookings ?? []) as Booking[]) {
    // Already flagged once — in any status. A dismissed notice means the manager
    // has dealt with it; re-raising it every week would be noise, not a safety net.
    const { data: seen } = await sb
      .from("alerts")
      .select("id")
      .eq("alert_type", "mid_retreat_needed")
      .eq("booking_id", b.id)
      .limit(1)
      .maybeSingle();
    if (seen) continue;

    // Or the shift already exists (created by hand, or by an older sync run that
    // still auto-created them) — nothing left to prompt for.
    const { data: shift } = await sb
      .from("shifts")
      .select("id")
      .eq("booking_id", b.id)
      .eq("shift_type", "mid_retreat")
      .limit(1)
      .maybeSingle();
    if (shift) continue;

    const mid = new Date(new Date(b.check_in).getTime() + Math.floor(b.nights / 2) * DAY);
    const suggestedDate = localDateStr(mid);

    await sb.from("alerts").insert({
      alert_type: "mid_retreat_needed",
      booking_id: b.id,
      title: "Mid-retreat clean needed",
      body: `${b.guest_name ?? "A booking"} is ${b.nights} nights — a mid-retreat clean is needed around ${prettyDate(suggestedDate)}. Create the shift manually.`,
    });
    fresh.push({ booking: b, suggestedDate });
  }

  if (!fresh.length) {
    await writeAuditLog(sb, {
      event_type: "mid_retreat.skipped",
      event_label: "Mid-Retreat Clean",
      status: "skipped",
      summary: "No new long stays (7+ nights) needing a mid-retreat clean. No notification sent.",
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: true, raised: 0 });
  }

  // One ALERT per booking above (each is actioned and dismissed on its own), but
  // ONE email and ONE WhatsApp for the run: several long stays in a roster must
  // not mean several near-identical messages to work through.
  const mail = midRetreatEmail(fresh.map(({ booking: b, suggestedDate }) => ({
    booking: { guest_name: b.guest_name, gcal_event_id: b.gcal_event_id, check_in: b.check_in, check_out: b.check_out },
    nights: b.nights,
    suggestedDate: prettyDate(suggestedDate),
  })));
  const sent = await sendEmail(mail.subject, mail.text, ops.email ?? undefined, mail.html);

  // The same digest on WhatsApp. A missing manager phone is not a failure — the
  // email and the alerts already carry it.
  const many = fresh.length > 1;
  const bookingList = fresh.map(({ booking: b, suggestedDate }) =>
    `• ${b.guest_name ?? "A booking"} — ${b.nights} nights\n` +
    `  📅 ${prettyDate(localDateStr(new Date(b.check_in)))} → ${prettyDate(localDateStr(new Date(b.check_out)))}\n` +
    `  ⏰ Suggested mid-stay date: ${prettyDate(suggestedDate)}`).join("\n\n");
  const waText = await renderTemplate(sb, "mid_retreat_whatsapp",
    `🧹 *Mid-Retreat Clean${many ? "s" : ""} Required*\n\n` +
    (many ? `${fresh.length} bookings are 7 nights or longer:\n\n` : "") +
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
      fresh.map(({ booking: b, suggestedDate }) => `${b.guest_name ?? "a booking"} (${b.nights}n, suggested ${suggestedDate})`).join("; ") +
      `. Alert(s) raised. Email ${sent.ok ? "sent" : "failed"}; WhatsApp ${waWord}.`,
    error_message: sent.ok ? undefined : "email provider returned an error",
    detail: {
      count: fresh.length,
      bookings: fresh.map(({ booking: b, suggestedDate }) =>
        ({ booking_id: b.id, guest: b.guest_name, nights: b.nights, suggested_date: suggestedDate })),
      emailed: sent.ok,
      whatsapped: waSent?.ok ?? false,
    },
    source: SOURCE,
    triggered_by: "cron",
  });

  return json({ ok: true, raised: fresh.length });
});

// wipeover-notify — cron. Scans upcoming bookings for a >3-day gap between two
// consecutive stays (a "wipeover" clean is needed in between), raises a venue_gap
// alert (shown on the Dashboard + Alerts page) and emails Ashleigh the wipeover
// notice — the old make.com scenario. Independently schedulable from the /schedule
// page. Dedupes on the alert body so re-runs don't re-alert or re-email.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { wipeoverEmail } from "../_shared/emailTemplates.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { loadBookingSyncRange } from "../_shared/settings.ts";

const DAY = 86400000;
const SOURCE = "wipeover-notify";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  // Scan the SAME horizon the weekly Booking Sync (schedule 1) plans into:
  // `leadWeeks + windowDays` ahead (default 5 weeks + 7 days). Previously this
  // scanned every upcoming booking with no upper bound, which flagged gaps far
  // beyond the planning window — e.g. a gap before the roster's first booking
  // read as a "3-day gap this week" when it was really just the empty run-up to
  // when bookings start. Bounding to the sync horizon means a gap is only
  // flagged once it falls inside the window we actually schedule cleans for, so
  // Ashleigh can plan a wipeover for that week in advance and never sooner.
  const { leadWeeks, windowDays } = await loadBookingSyncRange(sb);
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  // +1 day of slack on the upper bound so a check-in on the very last day of the
  // window still has its preceding gap measured, matching sync's fetch padding.
  const horizonEnd = new Date(todayStart.getTime() + (leadWeeks * 7 + windowDays + 1) * DAY);
  const { data: window } = await sb
    .from("bookings")
    .select("id, check_in, check_out, is_cancelled, guest_name, gcal_event_id")
    .gte("check_out", todayStart.toISOString())
    .lte("check_in", horizonEnd.toISOString())
    .eq("is_cancelled", false)
    .order("check_in");

  const sorted = window ?? [];
  let raised = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gapDays = (new Date(sorted[i].check_in).getTime() - new Date(sorted[i - 1].check_out).getTime()) / DAY;
    if (gapDays <= 3) continue;

    const from = sorted[i - 1].check_out.slice(0, 10);
    const to = sorted[i].check_in.slice(0, 10);
    const body = `No clean scheduled between ${from} and ${to}. Plan an extra clean?`;

    // Dedupe: one open venue_gap alert per gap (same body).
    const { data: dup } = await sb
      .from("alerts")
      .select("id")
      .eq("alert_type", "venue_gap")
      .eq("status", "open")
      .eq("body", body)
      .maybeSingle();
    if (dup) continue;

    await sb.from("alerts").insert({ alert_type: "venue_gap", title: "Venue gap > 3 days", body });
    raised++;

    const gapWhole = Math.round(gapDays);
    const mail = wipeoverEmail(sorted[i - 1], sorted[i], gapWhole);
    const sent = await sendEmail(mail.subject, mail.text, (await opsManager(sb)).email ?? undefined, mail.html);

    await writeAuditLog(sb, {
      event_type: "wipeover.notified",
      event_label: "Wipeover Cleaning",
      status: sent.ok ? "success" : "failed",
      summary: sent.ok
        ? `Wipeover clean needed — ${gapWhole}-day gap between ${from} and ${to}. Email sent to Ashleigh.`
        : `Wipeover clean needed — ${gapWhole}-day gap between ${from} and ${to}. Alert raised, but the email failed to send.`,
      detail: { from, to, gap_days: gapWhole, emailed: sent.ok },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  if (raised === 0) {
    await writeAuditLog(sb, {
      event_type: "wipeover.skipped",
      event_label: "Wipeover Cleaning",
      status: "skipped",
      summary: "No new venue gaps over 3 days found. No wipeover cleaning email needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, raised });
});

// HTML email builders. Kept table/inline-style based so they render in Gmail/Outlook
// (no <style> blocks, no flexbox). Both return { subject, text, html } — `text` is the
// plain-text fallback used when HTML isn't wanted.

const SHIFT_LABEL: Record<string, string> = {
  standard: "Standard Clean",
  mid_retreat: "Mid-Retreat Clean",
  deep_full_venue: "Deep Clean",
  wipeover: "Wipeover Clean",
  other: "Other Clean",
};

// The venue's timezone. Every instant an email renders is a venue-local moment,
// so it must be formatted here — never left to the runtime's zone (UTC).
const VENUE_TZ = "Australia/Sydney";

const GREEN = "#1F4D3A";
const AMBER = "#E08A1E";
const INK = "#1c241f";
const MUTED = "#6b7671";

export interface ConfirmShift {
  id: string;
  shift_type: string;
  shift_date: string;   // YYYY-MM-DD
  start_time: string;   // HH:MM(:SS)
  required_cleaners: number;
  guest_name?: string | null;
  nights?: number | null;
  check_in?: string | null;   // ISO
  check_out?: string | null;  // ISO
}

interface ConfirmOpts {
  weekFrom: string;   // human label
  weekTo: string;     // human label
  signedLinkFor: (id: string) => string;
  editUrlFor: (id: string) => string;
}

const ESC_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ESC_MAP[c] ?? c);
}

// Two shapes arrive here and they must be handled differently:
//
//   • a plain YYYY-MM-DD (shift_date) — carries no timezone, so it is formatted
//     by hand. Pushing it through Date would invent an instant and let the
//     runtime's zone move it across midnight.
//   • an ISO timestamp (check_in / check_out) — a real instant, formatted in
//     VENUE-LOCAL time. Without the explicit timeZone this rendered the UTC
//     date: Edge Functions run in UTC, and a 10:00 AEDT check-out is 23:00 the
//     PREVIOUS day in UTC, so every morning check-out printed a day early
//     (Amanda's 4 October check-out read as 3 October). shift_date, derived
//     from the same value via a Sydney-pinned formatter, was correct — which is
//     exactly why the two disagreed inside one email.
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (plain) return `${Number(plain[3])} ${MONTHS_LONG[Number(plain[2]) - 1]} ${plain[1]}`;
  const d = new Date(iso);
  return isNaN(+d)
    ? esc(iso.slice(0, 10))
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: VENUE_TZ });
}

function fmtTime(t?: string | null): string {
  if (!t) return "—";
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function button(href: string, label: string, bg: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;margin:0 6px;">${esc(label)}</a>`;
}

function row(label: string, value: string, headBg = "#fff"): string {
  return `<tr>
    <td style="background:${headBg};padding:10px 14px;font-size:12px;color:${MUTED};border-bottom:1px solid #eee;width:42%;">${esc(label)}</td>
    <td style="padding:10px 14px;font-size:13px;color:${INK};border-bottom:1px solid #eee;font-weight:600;">${value}</td>
  </tr>`;
}

function shiftBlock(s: ConfirmShift, opts: ConfirmOpts): string {
  const bookingName = esc(s.guest_name ?? "Guest booking");
  const bookingRows =
    row("Booking Name", bookingName) +
    row("Booking Nights", esc(s.nights ?? "—")) +
    row("Check-In", `<strong>${fmtDate(s.check_in)}</strong>`) +
    row("Check-Out", fmtDate(s.check_out));
  const assignRows =
    row("Shift Date & Time", `<strong>${fmtDate(s.shift_date)}</strong> · ${fmtTime(s.start_time)}`, "#FBF3E2") +
    row("Shift Type", esc(SHIFT_LABEL[s.shift_type] ?? s.shift_type), "#FBF3E2") +
    row("Cleaners Required", esc(s.required_cleaners), "#FBF3E2");

  return `<tr><td style="padding:22px 24px;border-top:1px solid #ececec;">
    <div style="font-size:13px;font-weight:700;color:${INK};border-bottom:2px solid ${GREEN};display:inline-block;padding-bottom:3px;margin-bottom:12px;">Booking Details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin-bottom:16px;">${bookingRows}</table>
    <div style="font-size:13px;font-weight:700;color:${INK};border-bottom:2px solid ${AMBER};display:inline-block;padding-bottom:3px;margin-bottom:12px;">Cleaning Shift Assignment</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0e6cf;border-radius:8px;overflow:hidden;margin-bottom:18px;">${assignRows}</table>
    <div style="text-align:center;">
      ${button(opts.signedLinkFor(s.id), "✓ Confirm Shift", GREEN)}
      ${button(opts.editUrlFor(s.id), "✎ Edit Shift", AMBER)}
    </div>
  </td></tr>`;
}

export function confirmationEmail(shifts: ConfirmShift[], opts: ConfirmOpts): { subject: string; text: string; html: string } {
  const subject = `Cleaning Shifts Confirmation Request — ${shifts.length} shift(s)`;
  const blocks = shifts.map((s) => shiftBlock(s, opts)).join("");

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:22px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:20px;font-weight:700;">Cleaning Shift Confirmation</div>
      </td></tr>
      <tr><td style="padding:18px 24px 0;text-align:center;">
        <span style="display:inline-block;background:#eaf4ee;color:${GREEN};font-size:13px;font-weight:600;padding:7px 16px;border-radius:20px;">📅 Week of: ${esc(opts.weekFrom)} to ${esc(opts.weekTo)}</span>
      </td></tr>
      ${blocks}
      <tr><td style="background:#f6f7f6;padding:16px 24px;text-align:center;color:${MUTED};font-size:12px;">
        💬 Questions? Contact your supervisor<br/>
        <span style="color:#9aa39d;">This is an automated notification. Please respond using the buttons above.</span>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;

  const text = `Cleaning Shift Confirmation — week of ${opts.weekFrom} to ${opts.weekTo}\n\n` +
    shifts.map((s) =>
      `• ${SHIFT_LABEL[s.shift_type] ?? s.shift_type} on ${s.shift_date} at ${fmtTime(s.start_time)} ` +
      `(${s.guest_name ?? "guest"})\n   Confirm: ${opts.signedLinkFor(s.id)}\n   Edit:    ${opts.editUrlFor(s.id)}`,
    ).join("\n\n");

  return { subject, text, html };
}

export interface GapBooking {
  guest_name?: string | null;
  gcal_event_id?: string | null;
  check_in: string;   // ISO
  check_out: string;  // ISO
}

// "11 May 2026, 3:00 PM" from an ISO timestamp; falls back to the raw string.
//
// Venue-local, like every other date in these emails. It used to render UTC and
// say so — honest, but it put a 10:00 AEDT check-out on screen as "3 October,
// 11:00 PM UTC", which reads as a day early at a glance and is the same
// off-by-one the confirmation email had. The reader is at the venue; give them
// the venue's clock.
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return esc(iso);
  return d.toLocaleString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: VENUE_TZ,
  });
}

function gapRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 14px;font-size:12px;color:${MUTED};border-bottom:1px solid #eee;width:42%;">${esc(label)}</td>
    <td style="padding:10px 14px;font-size:13px;color:${INK};border-bottom:1px solid #eee;font-weight:600;">${value}</td>
  </tr>`;
}

function bookingCard(headerBg: string, heading: string, b: GapBooking): string {
  const rows =
    gapRow("Booking Name", esc(b.guest_name ?? "Guest booking")) +
    gapRow("Event ID", `<span style="font-family:monospace;font-size:12px;color:${MUTED};">${esc(b.gcal_event_id ?? "—")}</span>`) +
    gapRow("Check-In Time", fmtDateTime(b.check_in)) +
    gapRow("Check-Out Time", fmtDateTime(b.check_out));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin:6px 0 14px;">
    <tr><td style="background:${headerBg};padding:11px 14px;color:#fff;font-size:13px;font-weight:700;">${heading}</td></tr>
    <tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
  </table>`;
}

// Notifies Ashleigh that a wipeover (interim) clean is needed in the >3-day gap
// between two bookings. Mirrors the original make.com layout.
export function wipeoverEmail(prev: GapBooking, next: GapBooking, gapDays: number): { subject: string; text: string; html: string } {
  const subject = `Wipeover Cleaning Required — ${gapDays}-day gap between bookings`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:22px 24px 4px;">
        <div style="font-size:19px;font-weight:700;color:${INK};">🧹 Wipeover Cleaning Required</div>
      </td></tr>
      <tr><td style="padding:8px 24px 0;color:${INK};font-size:13.5px;line-height:1.6;">
        This is to inform you that a <strong>wipeover cleaning</strong> is required between the following two bookings.
        <div style="margin-top:10px;">Reason: The gap between these bookings is <strong>more than 3 days</strong>.</div>
      </td></tr>
      <tr><td style="padding:14px 24px 0;">
        <div style="background:#FBF3E2;border-radius:8px;padding:11px 14px;font-size:13px;font-weight:600;color:#9a7320;">⏳ Gap Between Bookings: ${gapDays} days</div>
      </td></tr>
      <tr><td style="padding:16px 24px 0;">
        ${bookingCard("#2f6fb0", "📅 Previous Booking (Ends)", prev)}
        <div style="text-align:center;margin:2px 0 12px;">
          <span style="display:inline-block;background:${AMBER};color:#fff;font-size:12px;font-weight:700;padding:7px 16px;border-radius:20px;">⬇️ Gap: ${gapDays} Days ⬇️</span>
        </div>
        ${bookingCard("#2e8b57", "📅 Next Booking (Starts)", next)}
      </td></tr>
      <tr><td style="padding:6px 24px 22px;color:${MUTED};font-size:12.5px;line-height:1.6;">
        Please ensure the wipeover cleaning is scheduled accordingly.<br/><br/>Thank you,<br/>Wybalena Organic Farm
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
  const text = `Wipeover Cleaning Required — a wipeover clean is needed in the ${gapDays}-day gap between two bookings.\n\n` +
    `Previous booking (${prev.guest_name ?? "guest"}): ${fmtDateTime(prev.check_in)} → ${fmtDateTime(prev.check_out)}\n` +
    `Gap: ${gapDays} days\n` +
    `Next booking (${next.guest_name ?? "guest"}): ${fmtDateTime(next.check_in)} → ${fmtDateTime(next.check_out)}\n\n` +
    `Please ensure the wipeover cleaning is scheduled accordingly.`;
  return { subject, text, html };
}

// One booking needing a mid-retreat clean. `suggestedDate` arrives already
// display-formatted from the caller (prettyDate) — this file stays dependency-free.
export interface MidRetreatItem {
  booking: GapBooking;
  nights: number;
  suggestedDate: string;
}

// Notifies the Operations Manager that long stays (>=7 nights) need a
// mid-retreat clean. The system no longer creates those shifts automatically —
// the date and crew are a judgement call — so this is the prompt to schedule them.
// ALL of a run's long stays go in ONE email: the manager gets a single list to
// work through, matching how the confirmation email batches its shifts.
export function midRetreatEmail(items: MidRetreatItem[]): { subject: string; text: string; html: string } {
  const n = items.length;
  const many = n > 1;
  const subject = many
    ? `Mid-Retreat Cleans Required — ${n} bookings need a mid-stay clean`
    : `Mid-Retreat Clean Required — ${items[0].nights}-night stay${items[0].booking.guest_name ? ` (${items[0].booking.guest_name})` : ""}`;

  const cards = items.map(({ booking: b, nights, suggestedDate }) => {
    const rows =
      gapRow("Booking Name", esc(b.guest_name ?? "Guest booking")) +
      gapRow("Event ID", `<span style="font-family:monospace;font-size:12px;color:${MUTED};">${esc(b.gcal_event_id ?? "—")}</span>`) +
      gapRow("Check-In Time", fmtDateTime(b.check_in)) +
      gapRow("Check-Out Time", fmtDateTime(b.check_out)) +
      gapRow("Nights", `${nights} nights`) +
      gapRow("Suggested date (mid-stay)", `<strong style="color:#9a7320;">${esc(suggestedDate)}</strong>`);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin:6px 0 14px;">
      <tr><td style="background:#2e8b57;padding:11px 14px;color:#fff;font-size:13px;font-weight:700;">📅 ${esc(b.guest_name ?? "Guest booking")}</td></tr>
      <tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    </table>`;
  }).join("");

  const intro = many
    ? `<strong>${n} bookings</strong> in this roster are 7 nights or longer, so each needs a <strong>mid-retreat clean</strong> part-way through the stay.`
    : `This booking is <strong>${items[0].nights} nights</strong>, so a <strong>mid-retreat clean</strong> is required part-way through the stay.`;
  const callout = many
    ? `👉 Please create the Mid-Retreat Cleaning shifts for the ${n} bookings listed below.`
    : `👉 Please create the Mid-Retreat Cleaning shift for this booking.`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:22px 24px 4px;">
        <div style="font-size:19px;font-weight:700;color:${INK};">🧹 Mid-Retreat Clean${many ? "s" : ""} Required</div>
      </td></tr>
      <tr><td style="padding:8px 24px 0;color:${INK};font-size:13.5px;line-height:1.6;">
        ${intro}
        <div style="margin-top:10px;">Reason: The stay is <strong>7 nights or longer</strong>.</div>
        <div style="margin-top:12px;background:#e7f0ed;border-left:3px solid #2e8b57;border-radius:6px;padding:11px 14px;font-size:13.5px;font-weight:600;color:#21564b;">
          ${callout}
        </div>
      </td></tr>
      <tr><td style="padding:16px 24px 0;">
        ${cards}
      </td></tr>
      <tr><td style="padding:6px 24px 22px;color:${MUTED};font-size:12.5px;line-height:1.6;">
        ${many ? "These shifts are" : "This shift is"} <strong>not created automatically</strong> — please add ${many ? "them" : "it"} from the Shifts page, choosing the date and crew that suit each stay.
        <br/><br/>Thank you,<br/>Wybalena Organic Farm
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;

  const lines = items.map(({ booking: b, nights, suggestedDate }) =>
    `• ${b.guest_name ?? "Guest booking"} — ${nights} nights\n` +
    `  ${fmtDateTime(b.check_in)} → ${fmtDateTime(b.check_out)}\n` +
    `  Suggested date (mid-stay): ${suggestedDate}`).join("\n\n");
  const text = (many
    ? `Mid-Retreat Cleans Required — ${n} bookings in this roster are 7 nights or longer.\n\n`
    : `Mid-Retreat Clean Required — this ${items[0].nights}-night stay needs a mid-retreat clean.\n\n`) +
    `${callout.replace("👉 ", "")}\n\n${lines}\n\n` +
    `${many ? "These shifts are" : "This shift is"} not created automatically — please add ${many ? "them" : "it"} from the Shifts page.`;
  return { subject, text, html };
}

// ── Auth emails (sent by the send-auth-email hook, NOT by Supabase) ──────────
// Supabase's default auth templates are replaced by the Send Email hook; these
// builders produce the branded invite / password-reset emails instead.

function authShell(headerTitle: string, inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:22px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:20px;font-weight:700;">${esc(headerTitle)}</div>
        <div style="color:#7fa491;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;margin-top:4px;">Housekeeping Operations</div>
      </td></tr>
      ${inner}
      <tr><td style="background:#f6f7f6;padding:16px 24px;text-align:center;color:${MUTED};font-size:12px;">
        Wybalena Organic Farm · Byron Bay Hinterland<br/>
        <span style="color:#9aa39d;">This is an automated message — please do not reply.</span>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
}

// Invitation for a newly-provisioned app user. `acceptUrl` is the Supabase
// /auth/v1/verify link, which lands the user back on the app with a session so
// they can set their password (the #type=invite gate in AuthProvider).
export function inviteEmail(opts: { name?: string | null; acceptUrl: string }): { subject: string; text: string; html: string } {
  const subject = "You've been invited to Wybalena Housekeeping Operations";
  const hi = opts.name ? `Hi ${esc(opts.name)},` : "Hi there,";
  const inner = `
    <tr><td style="padding:26px 28px 8px;color:${INK};font-size:14px;line-height:1.6;">
      ${hi}<br/><br/>
      You've been invited to the <strong>Wybalena Housekeeping Operations</strong> portal — the cockpit for scheduling and confirming every clean between guests.
      Click below to accept your invitation and set a password.
    </td></tr>
    <tr><td style="padding:18px 28px 6px;text-align:center;">
      ${button(opts.acceptUrl, "Accept invitation & set password", GREEN)}
    </td></tr>
    <tr><td style="padding:14px 28px 24px;color:${MUTED};font-size:12.5px;line-height:1.6;">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <span style="color:${GREEN};word-break:break-all;">${esc(opts.acceptUrl)}</span><br/><br/>
      If you weren't expecting this invitation, you can safely ignore this email.
    </td></tr>`;
  const text = `${opts.name ? `Hi ${opts.name},` : "Hi there,"}\n\n` +
    `You've been invited to the Wybalena Housekeeping Operations portal. ` +
    `Accept your invitation and set a password using the link below:\n\n${opts.acceptUrl}\n\n` +
    `If you weren't expecting this invitation, you can safely ignore this email.`;
  return { subject, text, html: authShell("Welcome to Wybalena", inner) };
}

// Password reset for an existing user. `resetUrl` is the Supabase recovery
// /auth/v1/verify link (#type=recovery → SetPassword gate).
export function passwordResetEmail(opts: { name?: string | null; resetUrl: string }): { subject: string; text: string; html: string } {
  const subject = "Reset your Wybalena Housekeeping Operations password";
  const hi = opts.name ? `Hi ${esc(opts.name)},` : "Hi there,";
  const inner = `
    <tr><td style="padding:26px 28px 8px;color:${INK};font-size:14px;line-height:1.6;">
      ${hi}<br/><br/>
      We received a request to reset the password for your <strong>Wybalena Housekeeping Operations</strong> account.
      Click below to choose a new password.
    </td></tr>
    <tr><td style="padding:18px 28px 6px;text-align:center;">
      ${button(opts.resetUrl, "Reset password", GREEN)}
    </td></tr>
    <tr><td style="padding:14px 28px 24px;color:${MUTED};font-size:12.5px;line-height:1.6;">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <span style="color:${GREEN};word-break:break-all;">${esc(opts.resetUrl)}</span><br/><br/>
      If you didn't request a password reset, you can safely ignore this email — your password won't change.
    </td></tr>`;
  const text = `${opts.name ? `Hi ${opts.name},` : "Hi there,"}\n\n` +
    `We received a request to reset your Wybalena Housekeeping Operations password. ` +
    `Choose a new password using the link below:\n\n${opts.resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email.`;
  return { subject, text, html: authShell("Password Reset", inner) };
}

// Generic fallback for any other auth email type (magic link, email change,
// reauthentication) so the hook never crashes on an unhandled action.
export function genericAuthEmail(opts: { name?: string | null; actionUrl: string; token?: string }): { subject: string; text: string; html: string } {
  const subject = "Your Wybalena Housekeeping Operations sign-in link";
  const hi = opts.name ? `Hi ${esc(opts.name)},` : "Hi there,";
  const codeLine = opts.token
    ? `<tr><td style="padding:4px 28px 8px;text-align:center;color:${MUTED};font-size:12.5px;">Or use this code: <strong style="color:${INK};letter-spacing:2px;">${esc(opts.token)}</strong></td></tr>`
    : "";
  const inner = `
    <tr><td style="padding:26px 28px 8px;color:${INK};font-size:14px;line-height:1.6;">
      ${hi}<br/><br/>
      Use the link below to continue signing in to <strong>Wybalena Housekeeping Operations</strong>.
    </td></tr>
    <tr><td style="padding:18px 28px 6px;text-align:center;">
      ${button(opts.actionUrl, "Continue", GREEN)}
    </td></tr>
    ${codeLine}
    <tr><td style="padding:14px 28px 24px;color:${MUTED};font-size:12.5px;line-height:1.6;">
      If the button doesn't work, copy and paste this link into your browser:<br/>
      <span style="color:${GREEN};word-break:break-all;">${esc(opts.actionUrl)}</span><br/><br/>
      If you didn't request this, you can safely ignore this email.
    </td></tr>`;
  const text = `${opts.name ? `Hi ${opts.name},` : "Hi there,"}\n\n` +
    `Use the link below to continue signing in to Wybalena Housekeeping Operations:\n\n${opts.actionUrl}\n\n` +
    (opts.token ? `Or use this code: ${opts.token}\n\n` : "") +
    `If you didn't request this, you can safely ignore this email.`;
  return { subject, text, html: authShell("Sign in to Wybalena", inner) };
}

export function reminderEmail(opts: { count: number; shiftsUrl: string }): { subject: string; text: string; html: string } {
  const subject = `Wybalena: ${opts.count} shift(s) still need confirming`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:20px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:18px;font-weight:700;">Shifts awaiting confirmation</div>
      </td></tr>
      <tr><td style="padding:24px;color:${INK};font-size:14px;line-height:1.6;text-align:center;">
        <strong>${opts.count} cleaning shift(s)</strong> are still awaiting confirmation.<br/><br/>
        Please check the previous confirmation email and confirm the shifts, or open the Shifts page to review and confirm them there.
      </td></tr>
      <tr><td style="padding:0 24px 26px;text-align:center;">
        ${button(opts.shiftsUrl, "Confirm Shifts", GREEN)}
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
  const text = `${opts.count} cleaning shift(s) are still awaiting confirmation.\n\n` +
    `Please check the previous confirmation email and confirm the shifts, or open the Shifts page: ${opts.shiftsUrl}`;
  return { subject, text, html };
}

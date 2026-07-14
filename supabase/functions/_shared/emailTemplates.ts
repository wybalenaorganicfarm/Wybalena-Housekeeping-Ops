// HTML email builders. Kept table/inline-style based so they render in Gmail/Outlook
// (no <style> blocks, no flexbox). Both return { subject, text, html } — `text` is the
// plain-text fallback used when HTML isn't wanted.

const SHIFT_LABEL: Record<string, string> = {
  standard: "Standard Clean",
  mid_retreat: "Mid-Retreat Clean",
  deep_full_venue: "Deep Clean",
  other: "Other Clean",
};

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

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? esc(iso.slice(0, 10)) : d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
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

// "11 May 2026, 3:00 AM" from an ISO timestamp; falls back to the raw string.
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return esc(iso);
  return d.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
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

// Notifies Ashley that a wipeover (interim) clean is needed in the >3-day gap
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

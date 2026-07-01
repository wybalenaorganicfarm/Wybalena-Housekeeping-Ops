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

export function reminderEmail(opts: { count: number; dashboardUrl: string }): { subject: string; text: string; html: string } {
  const subject = `Wybalena: ${opts.count} shift(s) still need confirming`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ee;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${GREEN};padding:20px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:18px;font-weight:700;">Shifts awaiting confirmation</div>
      </td></tr>
      <tr><td style="padding:24px;color:${INK};font-size:14px;line-height:1.6;text-align:center;">
        <strong>${opts.count} cleaning shift(s)</strong> have been pending confirmation for over 5 hours.<br/><br/>
        Please check the previous confirmation email and confirm the shifts, or open the dashboard to review and confirm them there.
      </td></tr>
      <tr><td style="padding:0 24px 26px;text-align:center;">
        ${button(opts.dashboardUrl, "Go to Dashboard", GREEN)}
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;
  const text = `${opts.count} cleaning shift(s) have been pending confirmation for over 5 hours.\n\n` +
    `Please check the previous confirmation email and confirm the shifts, or open the dashboard: ${opts.dashboardUrl}`;
  return { subject, text, html };
}

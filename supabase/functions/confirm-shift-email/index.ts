// confirm-shift-email — PUBLIC (verify_jwt = false). The "Confirm Shift" button in
// the confirmation email is a plain link; clicking it lands here. We verify the HMAC
// token, confirm the shift if still pending, log who confirmed, and return a tiny
// branded page. No app, no sign-in. Idempotent: re-clicking a confirmed shift is a
// no-op (no duplicate log).
import { serviceClient } from "../_shared/client.ts";
import { verifyShift } from "../_shared/confirmToken.ts";
import { resolveAdminName } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const GREEN = "#1F4D3A";

function page(title: string, message: string, ok: boolean): Response {
  const icon = ok ? "✓" : "⚠";
  const accent = ok ? GREEN : "#a8392b";
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title></head>
  <body style="margin:0;background:#eef0ee;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;">
      <tr><td align="center" valign="middle" style="padding:40px;">
        <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.08);">
          <tr><td style="background:${accent};text-align:center;padding:26px;">
            <div style="color:#fff;font-size:40px;line-height:1;">${icon}</div>
          </td></tr>
          <tr><td style="padding:28px 28px 32px;text-align:center;">
            <div style="font-size:19px;font-weight:700;color:#1c241f;margin-bottom:8px;">${title}</div>
            <div style="font-size:14px;color:#6b7671;line-height:1.6;">${message}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const shiftId = url.searchParams.get("shift") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!shiftId || !(await verifyShift(shiftId, token))) {
    return page("Link no longer valid", "This confirmation link is invalid or has expired. Please open the app to confirm the shift.", false);
  }

  const sb = serviceClient();
  const { data: shift } = await sb
    .from("shifts")
    .select("id, status, shift_date")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift) {
    return page("Shift not found", "We couldn't find that shift. It may have been removed.", false);
  }

  // Idempotent: only act while pending; re-clicks just show success with no dup log.
  if (shift.status !== "pending_confirmation") {
    return page("Already confirmed", "This shift is already confirmed — no further action needed. You can close this tab.", true);
  }

  await sb.from("shifts")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", shiftId)
    .eq("status", "pending_confirmation");

  // Close any open unconfirmed_shifts alert for this shift.
  await sb.from("alerts")
    .update({ status: "actioned", actioned_at: new Date().toISOString() })
    .eq("shift_id", shiftId)
    .eq("alert_type", "unconfirmed_shifts")
    .eq("status", "open");

  const who = await resolveAdminName(sb);
  await writeAuditLog(sb, {
    event_type: "shift.confirmed",
    event_label: "Shift Confirmation",
    status: "success",
    summary: `${who} confirmed the shift on ${shift.shift_date} (via confirmation email). It can now be staffed.`,
    detail: { shift_id: shiftId, via: "email" },
    source: "confirm-shift-email",
    shift_id: shiftId,
    triggered_by: "webhook",
  });

  return page("Shift confirmed", "✓ The shift has been confirmed. You can close this tab.", true);
});

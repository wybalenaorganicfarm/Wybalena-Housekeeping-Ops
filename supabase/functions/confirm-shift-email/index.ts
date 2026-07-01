// confirm-shift-email — PUBLIC (verify_jwt = false). The "Confirm Shift" button in
// the confirmation email is a plain link; clicking it lands here. We verify the HMAC
// token, confirm the shift if still pending, log who confirmed, then REDIRECT to the
// app's /confirmed page.
//
// Why redirect instead of returning HTML: Supabase Edge Functions on the default
// *.supabase.co domain rewrite text/html responses to text/plain, so a page built
// here shows as raw source in the browser. The app (real hosting) renders HTML fine,
// so we hand off to it. Idempotent: re-clicking a confirmed shift is a no-op.
import { serviceClient } from "../_shared/client.ts";
import { verifyShift } from "../_shared/confirmToken.ts";
import { resolveAdminName } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SHIFT_LABEL: Record<string, string> = {
  standard: "Standard Clean",
  mid_retreat: "Mid-Retreat Clean",
  deep_full_venue: "Deep Clean",
  other: "Other Clean",
};

// "Standard Clean on 6 August 2026" — human label for the confirmation page.
function shiftLabel(shiftType: string, shiftDate: string): string {
  const type = SHIFT_LABEL[shiftType] ?? shiftType;
  const d = new Date(shiftDate);
  const when = isNaN(+d) ? shiftDate : d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  return `${type} on ${when}`;
}

// Redirect the browser to the app's public /confirmed page with the outcome.
function landing(status: "confirmed" | "already" | "invalid" | "notfound", label?: string): Response {
  const appUrl = Deno.env.get("APP_URL") ?? "";
  const qs = new URLSearchParams({ status, ...(label ? { label } : {}) });
  if (!appUrl) {
    // No app URL configured — plain-text fallback (HTML would be rewritten anyway).
    return new Response(`Shift ${status}${label ? `: ${label}` : ""}.`, { status: 200 });
  }
  return new Response(null, { status: 302, headers: { Location: `${appUrl}/confirmed?${qs}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const shiftId = url.searchParams.get("shift") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!shiftId || !(await verifyShift(shiftId, token))) {
    return landing("invalid");
  }

  const sb = serviceClient();
  const { data: shift } = await sb
    .from("shifts")
    .select("id, status, shift_date, shift_type")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift) return landing("notfound");

  const label = shiftLabel(shift.shift_type, shift.shift_date);

  // Idempotent: only act while pending; re-clicks just land on success with no dup log.
  if (shift.status !== "pending_confirmation") {
    return landing("already", label);
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

  return landing("confirmed", label);
});

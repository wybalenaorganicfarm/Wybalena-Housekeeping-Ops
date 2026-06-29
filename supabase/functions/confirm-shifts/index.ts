// confirm-shifts — app-facing. Ashley confirms / bulk-confirms pending shifts.
// Sets status=confirmed, confirmed_at/by and closes any open unconfirmed alerts.
// Caller must be admin or super_admin (Spec §7.3).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { shiftIds } = await req.json().catch(() => ({ shiftIds: [] }));
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) {
    return json({ error: "shiftIds required" }, 400);
  }

  const { data: updated, error } = await sb
    .from("shifts")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: caller.userId,
    })
    .in("id", shiftIds)
    .eq("status", "pending_confirmation") // only confirm pending ones
    .select("id");
  if (error) return json({ error: error.message }, 400);

  // Close any open unconfirmed_shifts alerts for those shifts.
  await sb.from("alerts")
    .update({ status: "actioned", actioned_by: caller.userId, actioned_at: new Date().toISOString() })
    .in("shift_id", shiftIds)
    .eq("alert_type", "unconfirmed_shifts")
    .eq("status", "open");

  const confirmed = (updated ?? []).map((s) => s.id);
  for (const id of confirmed) {
    const { data: sh } = await sb.from("shifts").select("shift_date, shift_type").eq("id", id).maybeSingle();
    await writeAuditLog(sb, {
      event_type: "shift.confirmed",
      event_label: "Shift Confirmation",
      status: "success",
      summary: `Shift on ${sh?.shift_date ?? "—"} confirmed. It can now be staffed.`,
      detail: { shift_id: id, by: caller.userId },
      source: "confirm-shifts",
      shift_id: id,
      triggered_by: "manual",
    });
  }

  return json({ ok: true, confirmed });
});

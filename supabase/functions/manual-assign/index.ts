// manual-assign — app-facing. Ashley manually offers a shift to a specific
// cleaner, bypassing tier order. Creates an `offered` assignment with
// is_manual_override=true and sends the Accept/Decline buttons — the cleaner must
// reply, so the status stays "awaiting" until they accept (not auto-accepted).
// Caller must be admin or super_admin (Spec §7.3).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { offerToCleaner } from "../_shared/engine.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { shiftId, cleanerId } = await req.json().catch(() => ({}));
  if (!shiftId || !cleanerId) return json({ error: "shiftId and cleanerId required" }, 400);

  const result = await offerToCleaner(sb, shiftId, cleanerId);
  if (result === "send_failed") {
    const { data: cl } = await sb.from("cleaners").select("full_name").eq("id", cleanerId).maybeSingle();
    await writeAuditLog(sb, {
      event_type: "assignment.manual",
      event_label: "Manual Assignment",
      status: "failed",
      summary: `Manual offer to ${cl?.full_name ?? "a cleaner"} could not be sent — the WhatsApp channel needs re-authorisation. No offer went out.`,
      error_message: "whatsapp send failed",
      detail: { shift_id: shiftId, cleaner_id: cleanerId, by: caller.userId },
      source: "manual-assign",
      shift_id: shiftId,
      cleaner_id: cleanerId,
      triggered_by: "manual",
    });
    return json({ error: "whatsapp send failed — the messaging channel needs reconnecting" }, 502);
  }
  if (result === "inactive") {
    const { data: cl } = await sb.from("cleaners").select("full_name").eq("id", cleanerId).maybeSingle();
    await writeAuditLog(sb, {
      event_type: "assignment.manual",
      event_label: "Manual Assignment",
      status: "failed",
      summary: `Manual offer to ${cl?.full_name ?? "a cleaner"} was blocked — the cleaner is Away/Inactive.`,
      error_message: "cleaner inactive",
      detail: { shift_id: shiftId, cleaner_id: cleanerId, by: caller.userId },
      source: "manual-assign",
      shift_id: shiftId,
      cleaner_id: cleanerId,
      triggered_by: "manual",
    });
    return json({ error: "that cleaner is Away or Inactive — set them Active before assigning" }, 400);
  }
  if (result === "error") {
    await writeAuditLog(sb, {
      event_type: "assignment.manual",
      event_label: "Manual Assignment",
      status: "failed",
      summary: "Manual assignment failed — the shift or cleaner could not be found.",
      error_message: "shift or cleaner not found",
      detail: { shift_id: shiftId, cleaner_id: cleanerId, by: caller.userId },
      source: "manual-assign",
      triggered_by: "manual",
    });
    return json({ error: "could not offer (shift or cleaner not found)" }, 400);
  }

  const { data: sh } = await sb.from("shifts").select("shift_date").eq("id", shiftId).maybeSingle();
  const { data: cl } = await sb.from("cleaners").select("full_name").eq("id", cleanerId).maybeSingle();
  await writeAuditLog(sb, {
    event_type: "assignment.manual",
    event_label: "Manual Assignment",
    status: "success",
    summary: `Shift on ${sh?.shift_date ?? "—"} manually offered to ${cl?.full_name ?? "a cleaner"}.`,
    detail: { shift_id: shiftId, cleaner_id: cleanerId, by: caller.userId },
    source: "manual-assign",
    shift_id: shiftId,
    cleaner_id: cleanerId,
    triggered_by: "manual",
  });

  return json({ ok: true, status: "offered" });
});

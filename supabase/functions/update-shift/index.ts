// update-shift — app-facing. Ashley edits a shift's fields from the Edit Shift modal.
// Routed through an Edge Function (not a direct RLS update) so the change is recorded
// in the audit log — audit_logs has no frontend write policy. Caller must be a writer.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

// Only these fields are editable from the modal — ignore anything else the client sends.
const EDITABLE = ["start_time", "estimated_hours", "shift_type", "required_cleaners", "special_instructions"] as const;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { shiftId, patch } = await req.json().catch(() => ({}));
  if (!shiftId || !patch || typeof patch !== "object") {
    return json({ error: "shiftId and patch required" }, 400);
  }

  const clean: Record<string, unknown> = { is_modified: true };
  for (const k of EDITABLE) {
    if (k in patch) clean[k] = patch[k];
  }
  // Record who set the special instructions (and when) so the UI can attribute them.
  if ("special_instructions" in patch) {
    const hasNote = typeof patch.special_instructions === "string" && patch.special_instructions.trim().length > 0;
    clean["special_instructions_by"] = hasNote ? caller.userId : null;
    clean["special_instructions_at"] = hasNote ? new Date().toISOString() : null;
  }

  const { error } = await sb.from("shifts").update(clean).eq("id", shiftId);
  if (error) return json({ error: error.message }, 400);

  const { data: sh } = await sb.from("shifts").select("shift_date").eq("id", shiftId).maybeSingle();
  const { data: me } = await sb.from("profiles").select("full_name").eq("id", caller.userId).maybeSingle();
  const who = me?.full_name ?? "The admin";

  await writeAuditLog(sb, {
    event_type: "shift.edited",
    event_label: "Shift Edited",
    status: "success",
    summary: `${who} edited the shift on ${sh?.shift_date ?? "—"}.`,
    detail: { shift_id: shiftId, fields: Object.keys(clean).filter((k) => k !== "is_modified"), by: caller.userId },
    source: "update-shift",
    shift_id: shiftId,
    triggered_by: "manual",
  });

  return json({ ok: true });
});

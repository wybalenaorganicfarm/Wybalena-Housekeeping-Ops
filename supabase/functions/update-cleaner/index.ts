// update-cleaner — app-facing (admin / operations_manager). Edits a cleaner's
// contact details (phone, email) from the Cleaners table — e.g. a cleaner changed
// their number, or the email wasn't known at creation time. Routed through an Edge
// Function for the audit trail + phone/email validation and duplicate checks.
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

  const body = await req.json().catch(() => ({}));
  const cleanerId = String(body.cleanerId ?? "");
  const phone = String(body.phone ?? "").trim();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;

  if (!cleanerId) return json({ ok: false, error: "cleanerId is required" });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return json({ ok: false, error: "A valid phone with country code is required" });

  const { data: cleaner, error: loadErr } = await sb
    .from("cleaners").select("id, full_name").eq("id", cleanerId).maybeSingle();
  if (loadErr) return json({ ok: false, error: loadErr.message });
  if (!cleaner) return json({ ok: false, error: "cleaner not found" });

  // Duplicate check against OTHER cleaners (no DB unique constraint).
  const phoneDigits = phone.replace(/\D/g, "");
  const { data: roster } = await sb.from("cleaners").select("id, full_name, phone, email");
  for (const r of (roster ?? []) as { id: string; full_name: string; phone: string; email: string | null }[]) {
    if (r.id === cleanerId) continue;
    if (r.phone.replace(/\D/g, "") === phoneDigits) return json({ ok: false, error: `That phone number is already used by ${r.full_name}` });
    if (email && (r.email ?? "").trim().toLowerCase() === email) return json({ ok: false, error: `That email is already used by ${r.full_name}` });
  }

  const { error } = await sb.from("cleaners").update({ phone, email }).eq("id", cleanerId);
  if (error) return json({ ok: false, error: error.message });

  await writeAuditLog(sb, {
    event_type: "cleaner.updated",
    event_label: "Cleaner Updated",
    status: "success",
    summary: `${cleaner.full_name}'s contact details were updated.`,
    detail: { cleaner_id: cleanerId, by: caller.userId },
    source: "update-cleaner",
    cleaner_id: cleanerId,
    triggered_by: "manual",
  });

  return json({ ok: true });
});

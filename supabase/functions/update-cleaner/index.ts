// update-cleaner — app-facing (admin / operations_manager). Edits a cleaner's
// contact details (phone, email) and their tier from the Cleaners table — e.g. a
// cleaner changed their number, or has earned a promotion to Tier 1. Routed
// through an Edge Function for the audit trail + validation and duplicate checks.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const TIERS = ["tier_1", "tier_2", "tier_3"];
const TIER_WORD: Record<string, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

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
  // Tier is optional — omitted means "leave as is".
  const tier = body.tier == null ? null : String(body.tier);

  if (!cleanerId) return json({ ok: false, error: "cleanerId is required" });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return json({ ok: false, error: "A valid phone with country code is required" });
  if (tier !== null && !TIERS.includes(tier)) return json({ ok: false, error: "Invalid tier" });

  const { data: cleaner, error: loadErr } = await sb
    .from("cleaners").select("id, full_name, tier").eq("id", cleanerId).maybeSingle();
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

  const tierChanged = tier !== null && tier !== cleaner.tier;
  const { error } = await sb.from("cleaners")
    .update({ phone, email, ...(tierChanged ? { tier } : {}) }).eq("id", cleanerId);
  if (error) return json({ ok: false, error: error.message });

  // Spell the tier move out in the log — it changes who gets offered shifts first.
  const summary = tierChanged
    ? `${cleaner.full_name} was moved from ${TIER_WORD[cleaner.tier] ?? cleaner.tier} to ${TIER_WORD[tier!]}, and their contact details were updated.`
    : `${cleaner.full_name}'s contact details were updated.`;

  await writeAuditLog(sb, {
    event_type: "cleaner.updated",
    event_label: "Cleaner Updated",
    status: "success",
    summary,
    detail: { cleaner_id: cleanerId, by: caller.userId, ...(tierChanged ? { from_tier: cleaner.tier, to_tier: tier } : {}) },
    source: "update-cleaner",
    cleaner_id: cleanerId,
    triggered_by: "manual",
  });

  // Echo the saved tier back so the client can tell a current deployment from an
  // older one that silently ignored the field.
  return json({ ok: true, tier: tierChanged ? tier : cleaner.tier });
});

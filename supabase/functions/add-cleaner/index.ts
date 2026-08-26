// add-cleaner — app-facing. An ops manager (admin/super_admin) adds a cleaner.
// Inserts the roster row, then welcomes the cleaner on WhatsApp (the only channel
// cleaners are contacted on — see the note above the send below).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const VALID_TIERS = ["tier_1", "tier_2", "tier_3"];
const TIER_NAME: Record<string, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const full_name = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const tier = String(body.tier ?? "");

  if (!full_name) return json({ ok: false, error: "Name is required" });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return json({ ok: false, error: "A valid phone with country code is required" });
  if (!VALID_TIERS.includes(tier)) return json({ ok: false, error: "Invalid tier" });

  // Backstop duplicate check (no DB unique constraint on phone/email).
  const phoneDigits = phone.replace(/\D/g, "");
  const { data: roster } = await sb.from("cleaners").select("full_name, phone, email");
  for (const r of (roster ?? []) as { full_name: string; phone: string; email: string | null }[]) {
    if (r.phone.replace(/\D/g, "") === phoneDigits) return json({ ok: false, error: `That phone number is already used by ${r.full_name}` });
    if (email && (r.email ?? "").trim().toLowerCase() === email) return json({ ok: false, error: `That email is already used by ${r.full_name}` });
  }

  const { data: created, error } = await sb
    .from("cleaners").insert({ full_name, phone, email, tier }).select("id").single();
  if (error) return json({ ok: false, error: error.message });

  await writeAuditLog(sb, {
    event_type: "cleaner.added",
    event_label: "Cleaner Added",
    status: "success",
    summary: `New cleaner added to the roster: ${full_name} (${TIER_NAME[tier] ?? tier}).`,
    detail: { cleaner_id: created?.id, tier, by: caller.userId },
    source: "add-cleaner",
    cleaner_id: created?.id,
    triggered_by: "manual",
  });

  // Notify the new cleaner — WhatsApp ONLY.
  //
  // There used to be a welcome EMAIL here as well, with its wording hardcoded in
  // this file. It was invisible from /templates, so editing the `cleaner_welcome`
  // template changed the WhatsApp message while every new cleaner kept receiving
  // the old hardcoded email — which is exactly what happened when the real
  // cleaning team was onboarded. WhatsApp is the channel cleaners actually work
  // on, so the email is gone rather than templated: one channel, one wording,
  // edited in one place.
  //
  // The adapter is stubbed (log only) until creds are set, and a notification
  // failure must NEVER fail creation — the row already exists.
  let whatsapped = false;
  try {
    const wa = await sendMessage(
      phone,
      await renderTemplate(sb, "cleaner_welcome",
        `Hi ${full_name}! You've been added to the Wybalena cleaning roster. You'll get shift offers here on WhatsApp — reply YES to accept or NO to decline. Welcome aboard! 🧹`,
        { cleaner_name: full_name }),
    );
    whatsapped = wa.ok;
  } catch (e) {
    console.error(`[add-cleaner] whatsapp notify failed: ${e}`);
  }

  return json({ ok: true, id: created?.id, whatsapped });
});

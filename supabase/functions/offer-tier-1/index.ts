// offer-tier-1 — cron: daily 15:00 IST testing (09:30 UTC); go-live tz TBD.
// For confirmed, not-yet-staffed shifts: offer Tier 1, set status=staffing,
// current_tier=tier_1, and send a WhatsApp summary to Zara (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "offer-tier-1";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type")
    .eq("status", "confirmed");

  let offered = 0;
  for (const s of shifts ?? []) {
    try {
      const res = await offerTier(sb, s.id, "tier_1");
      if (res.count > 0) {
        offered += res.count;
        const names = res.offered.map((c) => c.full_name).join(", ");
        await writeAuditLog(sb, {
          event_type: "offer.tier1_sent",
          event_label: "Tier 1 Offers",
          status: "success",
          summary: `Tier 1 offers sent for shift on ${res.shiftDate}. ${res.count} cleaner(s) offered: ${names}.`,
          detail: { shift_id: s.id, count: res.count, cleaners: res.offered },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "offer.tier1_sent",
        event_label: "Tier 1 Offers",
        status: "failed",
        summary: `Failed to send Tier 1 offers for shift on ${s.shift_date}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  if (offered === 0) {
    await writeAuditLog(sb, {
      event_type: "offer.tier1_skipped",
      event_label: "Tier 1 Offers",
      status: "skipped",
      summary: "No confirmed shifts needed staffing today. No Tier 1 offers sent.",
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: true, offersSent: 0 });
  }

  // Summary to Zara (team leader). Find her cleaner row.
  const { data: zara } = await sb
    .from("cleaners").select("phone").eq("is_team_leader", true).limit(1).maybeSingle();
  if (zara?.phone) {
    const sent = await sendMessage(zara.phone, `Tier 1 offers sent for today's confirmed shifts (${offered} offers).`);
    await writeAuditLog(sb, {
      event_type: "notification.zara_summary",
      event_label: "Zara Shift Summary",
      status: sent.ok ? "success" : "failed",
      summary: sent.ok
        ? "WhatsApp shift summary sent to Zara."
        : "Failed to send WhatsApp shift summary to Zara.",
      detail: { offers: offered },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, offersSent: offered });
});

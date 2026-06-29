// escalate-tier-2 — cron: Tue 09:00 IST testing (Tue 03:30 UTC); go-live tz TBD.
// 24h after Tier 1: any shift still not fully staffed -> offer Tier 2 (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "escalate-tier-2";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Shifts in Tier-1 staffing whose Tier-1 batch is >=24h old and still open.
  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date")
    .eq("status", "staffing")
    .eq("current_tier", "tier_1");

  let escalated = 0;
  for (const s of shifts ?? []) {
    const { data: lastT1 } = await sb
      .from("shift_assignments")
      .select("offered_at")
      .eq("shift_id", s.id)
      .eq("tier_at_offer", "tier_1")
      .order("offered_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastT1 || lastT1.offered_at > cutoff) continue; // not yet 24h

    try {
      const res = await offerTier(sb, s.id, "tier_2");
      if (res.count > 0) {
        escalated += res.count;
        const names = res.offered.map((c) => c.full_name).join(", ");
        await writeAuditLog(sb, {
          event_type: "escalation.tier2_triggered",
          event_label: "Tier 2 Escalation",
          status: "success",
          summary: `Tier 2 escalation triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled. Tier 2 offers sent to: ${names}.`,
          detail: { shift_id: s.id, open_spots: res.openSpots, count: res.count, cleaners: res.offered },
          source: SOURCE,
          shift_id: s.id,
          triggered_by: "cron",
        });
      }
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "escalation.tier2_triggered",
        event_label: "Tier 2 Escalation",
        status: "failed",
        summary: `Tier 2 escalation failed for shift on ${s.shift_date}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  if (escalated === 0) {
    await writeAuditLog(sb, {
      event_type: "escalation.tier2_skipped",
      event_label: "Tier 2 Escalation",
      status: "skipped",
      summary: "All confirmed shifts are fully staffed. No Tier 2 escalation needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, escalatedOffers: escalated });
});

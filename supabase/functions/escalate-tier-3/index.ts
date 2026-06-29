// escalate-tier-3 — cron: Wed 14:00 IST testing (Wed 08:30 UTC); go-live tz TBD.
// 24h after Tier 2: still not fully staffed -> offer Tier 3 + raise
// understaffed_urgent alert + urgent email to Ashley (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { offerTier } from "../_shared/engine.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "escalate-tier-3";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type")
    .eq("status", "staffing")
    .eq("current_tier", "tier_2");

  let escalated = 0;
  for (const s of shifts ?? []) {
    const { data: lastT2 } = await sb
      .from("shift_assignments")
      .select("offered_at")
      .eq("shift_id", s.id)
      .eq("tier_at_offer", "tier_2")
      .order("offered_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastT2 || lastT2.offered_at > cutoff) continue;

    try {
      const res = await offerTier(sb, s.id, "tier_3");
      escalated++;

      // Raise urgent alert (dedupe one open per shift) + urgent email.
      const { data: dup } = await sb
        .from("alerts")
        .select("id")
        .eq("alert_type", "understaffed_urgent")
        .eq("shift_id", s.id)
        .eq("status", "open")
        .maybeSingle();
      if (!dup) {
        await sb.from("alerts").insert({
          alert_type: "understaffed_urgent",
          shift_id: s.id,
          title: "Tier 3 reached — understaffed",
          body: `${s.shift_type} on ${s.shift_date} reached Tier 3 and still has open spots. Intervene manually.`,
        });
      }
      await sendEmail(
        "Wybalena URGENT: shift understaffed at Tier 3",
        `The ${s.shift_type} shift on ${s.shift_date} has reached Tier 3 and is still ` +
          `not fully staffed. Please assign cleaners manually.`,
      );

      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: "warning",
        summary: `Tier 3 escalation triggered for shift on ${s.shift_date}. ${res.openSpots} spot(s) still unfilled after Tier 2. Tier 3 offers sent. Ashley notified urgently.`,
        detail: { shift_id: s.id, open_spots: res.openSpots, count: res.count, cleaners: res.offered },
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    } catch (e) {
      await writeAuditLog(sb, {
        event_type: "escalation.tier3_triggered",
        event_label: "Tier 3 Escalation",
        status: "failed",
        summary: `Tier 3 escalation failed for shift on ${s.shift_date}. Error: ${String(e)}.`,
        error_message: String(e),
        source: SOURCE,
        shift_id: s.id,
        triggered_by: "cron",
      });
    }
  }

  if (escalated === 0) {
    await writeAuditLog(sb, {
      event_type: "escalation.tier3_skipped",
      event_label: "Tier 3 Escalation",
      status: "skipped",
      summary: "All shifts fully staffed. No Tier 3 escalation needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, escalatedShifts: escalated });
});

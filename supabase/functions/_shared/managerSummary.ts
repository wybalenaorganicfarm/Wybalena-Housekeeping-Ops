// Manager (team leader / Zara) WhatsApp summary for tier offer runs.
// Shared by offer-tier-1, escalate-tier-2 and escalate-tier-3 so the manager
// gets one consistent per-shift breakdown: shift date/time, type, tier and the
// name of every cleaner the offer went to.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { writeAuditLog } from "./auditLog.ts";

export interface ShiftOfferSummary {
  shiftDate: string;
  startTime: string; // "HH:MM" or ""
  shiftType: string;
  names: string[];
}

const TIER_LABEL: Record<string, string> = {
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
};

function prettyType(t: string): string {
  return (t ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Build the manager summary message: a per-shift block listing date/time, type,
// tier and each offered cleaner's name.
export function buildManagerSummary(
  tier: string,
  summaries: ShiftOfferSummary[],
  totalOffers: number,
): string {
  const tierLabel = TIER_LABEL[tier] ?? tier;
  const blocks = summaries.map((s) => {
    const time = s.startTime ? ` · ⏰ ${s.startTime}` : "";
    const roster = s.names.map((n) => `   • ${n}`).join("\n");
    return `📅 ${s.shiftDate}${time}\n🧹 ${prettyType(s.shiftType)}\n` +
      `👥 ${tierLabel} — ${s.names.length} cleaner(s):\n${roster}`;
  });
  return (
    `*${tierLabel} Shift Offers — Summary* 📋\n\n` +
    blocks.join("\n\n") +
    `\n\n_Total: ${totalOffers} offer(s) across ${summaries.length} shift(s)._`
  );
}

// Find the team leader (Zara) and send the per-shift offer summary via WhatsApp,
// then record the outcome in the audit log. No-op when nothing was offered.
export async function notifyManagerSummary(
  sb: SupabaseClient,
  tier: string,
  summaries: ShiftOfferSummary[],
  totalOffers: number,
  source: string,
): Promise<void> {
  if (summaries.length === 0) return;
  // The team lead is a profiles row (role = team_leader), not a cleaner.
  const { data: lead } = await sb
    .from("profiles").select("phone").eq("role", "team_leader").eq("is_active", true).limit(1).maybeSingle();
  if (!lead?.phone) return;

  const tierLabel = TIER_LABEL[tier] ?? tier;
  const sent = await sendMessage(lead.phone, buildManagerSummary(tier, summaries, totalOffers));
  await writeAuditLog(sb, {
    event_type: "notification.zara_summary",
    event_label: "Zara Shift Summary",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `WhatsApp ${tierLabel} shift summary sent to Zara.`
      : `Failed to send WhatsApp ${tierLabel} shift summary to Zara.`,
    detail: { tier, offers: totalOffers, shifts: summaries },
    source,
    triggered_by: "cron",
  });
}

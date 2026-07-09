// Manager (team leader / Zara) WhatsApp summary for tier offer runs.
// Shared by offer-tier-1, escalate-tier-2 and escalate-tier-3 so the manager
// gets one consistent per-shift breakdown: shift date/time, type, tier and the
// name of every cleaner the offer went to.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { sendEmail } from "./adapters/email.ts";
import { opsManager } from "./admin.ts";
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

// One shift whose offers could NOT be delivered because the WhatsApp channel
// rejected the send — collected across a run and emailed to the ops manager.
export interface OfferFailure {
  shiftDate: string;
  startTime: string; // "HH:MM" or ""
  shiftType: string;
  names: string[]; // cleaners we couldn't reach
}

// Email the ops manager (Ashleigh) that WhatsApp offers could not be sent, and
// record it in the audit log. No-op when nothing failed. Called once per run so
// Ashleigh gets a single consolidated notice, not one email per cleaner.
export async function notifyOfferFailure(
  sb: SupabaseClient,
  tier: string,
  failures: OfferFailure[],
  source: string,
): Promise<void> {
  if (failures.length === 0) return;
  const tierLabel = TIER_LABEL[tier] ?? tier;
  const totalNames = failures.reduce((n, f) => n + f.names.length, 0);
  const lines = failures.map((f) => {
    const time = f.startTime ? ` at ${f.startTime}` : "";
    return `• ${prettyType(f.shiftType)} on ${f.shiftDate}${time} — ${f.names.join(", ")}`;
  }).join("\n");
  const subject = `Wybalena: ${tierLabel} shift offers could NOT be sent`;
  const text =
    `The system tried to send ${tierLabel} shift offers, but WhatsApp rejected them — ` +
    `the messaging channel needs re-authorisation.\n\n` +
    `${totalNames} cleaner(s) were NOT notified and no offers went out for:\n\n${lines}\n\n` +
    `Please reconnect the WhatsApp channel, then re-run the offers from the Schedule page.`;

  const mgr = await opsManager(sb);
  const sent = await sendEmail(subject, text, mgr.email ?? undefined);
  await writeAuditLog(sb, {
    event_type: "offer.delivery_failed",
    event_label: "Offer Delivery Failed",
    status: "failed",
    summary:
      `${totalNames} ${tierLabel} offer(s) could not be delivered — the WhatsApp channel needs reconnecting. ` +
      (sent.ok ? `${mgr.name} has been emailed.` : `${mgr.name} could NOT be emailed either.`),
    error_message: "whatsapp send failed",
    detail: { tier, failures, emailed: sent.ok },
    source,
    triggered_by: "cron",
  });
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

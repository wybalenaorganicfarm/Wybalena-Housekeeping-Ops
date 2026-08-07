// Team-lead (Zara) notifications.
//
// The lead gets exactly ONE WhatsApp about staffing: the day before the shift,
// listing the confirmed roster (pre-shift-reminder). Tier offer runs deliberately
// send her nothing — offers churn as cleaners accept/decline, so a message per
// tier run was noise. Offer delivery *failures* still email the ops manager.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { sendEmail } from "./adapters/email.ts";
import { opsManager } from "./admin.ts";
import { prettyDate, prettyTime } from "./datetime.ts";
import { renderTemplate } from "./templates.ts";
import { writeAuditLog } from "./auditLog.ts";

// One of tomorrow's shifts and the cleaners who accepted it.
export interface ShiftRoster {
  shiftId: string;
  shiftDate: string;
  startTime: string; // "HH:MM" or ""
  shiftType: string;
  names: string[]; // accepted cleaners; empty when nobody confirmed
}

const TIER_LABEL: Record<string, string> = {
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
};

function prettyType(t: string): string {
  return (t ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Build the day-before roster message: one block per shift with date/time, type
// and every confirmed cleaner. Shifts with nobody confirmed are still listed so
// the lead can chase them.
// The per-shift blocks — substituted into the editable `lead_roster` template as
// {{shift_blocks}}. Kept separate so the wording around them stays editable
// while the generated list itself remains code-owned.
export function buildRosterBlocks(rosters: ShiftRoster[]): string {
  return rosters.map((r) => {
    const time = r.startTime ? ` · ⏰ ${prettyTime(r.startTime)}` : "";
    const roster = r.names.length
      ? `👥 ${r.names.length} cleaner(s) confirmed:\n` +
        r.names.map((n) => `   • ${n}`).join("\n")
      : "⚠️ No cleaners confirmed yet.";
    return `📅 ${prettyDate(r.shiftDate)}${time}\n🧹 ${prettyType(r.shiftType)}\n${roster}`;
  }).join("\n\n");
}

export function buildLeadRoster(rosters: ShiftRoster[]): string {
  const total = rosters.reduce((n, r) => n + r.names.length, 0);
  return (
    `*Tomorrow's Roster* 📋\n\n` +
    buildRosterBlocks(rosters) +
    `\n\n_Total: ${total} cleaner(s) across ${rosters.length} shift(s)._`
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

// Find the team leader (Zara) and send ONE WhatsApp with tomorrow's confirmed
// roster, then record the outcome in the audit log. Called once per day from
// pre-shift-reminder. No-op when there are no shifts tomorrow.
export async function notifyLeadRoster(
  sb: SupabaseClient,
  rosters: ShiftRoster[],
  source: string,
): Promise<void> {
  if (rosters.length === 0) return;
  // The team lead is a profiles row (role = team_leader), not a cleaner.
  const { data: lead } = await sb
    .from("profiles").select("phone").eq("role", "team_leader").eq("is_active", true).limit(1).maybeSingle();
  if (!lead?.phone) return;

  const total = rosters.reduce((n, r) => n + r.names.length, 0);
  const text = await renderTemplate(sb, "lead_roster", buildLeadRoster(rosters), {
    shift_blocks: buildRosterBlocks(rosters),
    total_cleaners: total,
    total_shifts: rosters.length,
  });
  const sent = await sendMessage(lead.phone, text);
  await writeAuditLog(sb, {
    event_type: "notification.zara_summary",
    event_label: "Zara Shift Summary",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `Tomorrow's roster sent to Zara — ${total} cleaner(s) across ${rosters.length} shift(s).`
      : "Failed to send tomorrow's roster to Zara.",
    detail: { shifts: rosters, cleaners: total },
    source,
    triggered_by: "cron",
  });
}

// Tell the team lead a cleaner has dropped off one of their shifts, so they know
// the roster changed without waiting for tomorrow's summary. Called whenever a
// cancellation is confirmed — by the cleaner over WhatsApp, or by the office.
// Silent no-op when there is no active team lead or they have no phone: the
// admin alert and audit log already record the cancellation.
export async function notifyLeadCancellation(
  sb: SupabaseClient,
  opts: {
    cleanerName: string;
    shiftDate: string;   // YYYY-MM-DD
    startTime: string;   // HH:MM(:SS)
    shiftType?: string | null;
    shiftId?: string | null;
    cleanerId?: string | null;
    remaining?: number | null;  // cleaners still confirmed
    required?: number | null;   // cleaners the shift needs
    source: string;
    triggeredBy?: "webhook" | "manual" | "cron";
  },
): Promise<void> {
  const { data: lead } = await sb
    .from("profiles").select("phone").eq("role", "team_leader").eq("is_active", true).limit(1).maybeSingle();
  if (!lead?.phone) return;

  const when = `${prettyDate(opts.shiftDate)} at ${prettyTime(opts.startTime)}`;
  const type = opts.shiftType ? `${prettyType(opts.shiftType)} · ` : "";
  const staffing = opts.remaining != null && opts.required != null
    ? `\n👥 Now ${opts.remaining}/${opts.required} confirmed.`
    : "";
  const fallback =
    `⚠️ *Cleaner cancelled*\n\n` +
    `${opts.cleanerName} has cancelled their spot.\n` +
    `📅 ${type}${when}${staffing}\n\n` +
    `The office has been alerted and re-assignment is in progress.`;

  const text = await renderTemplate(sb, "lead_cleaner_cancelled", fallback, {
    cleaner_name: opts.cleanerName,
    shift_date: prettyDate(opts.shiftDate),
    start_time: prettyTime(opts.startTime),
    shift_type: opts.shiftType ? prettyType(opts.shiftType) : "",
    remaining: opts.remaining ?? "",
    required: opts.required ?? "",
  });

  const sent = await sendMessage(lead.phone, text);
  await writeAuditLog(sb, {
    event_type: "notification.lead_cancellation",
    event_label: "Team Lead Notified",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `Team lead notified — ${opts.cleanerName} cancelled their spot on ${when}.`
      : `Failed to notify the team lead that ${opts.cleanerName} cancelled their spot on ${when}.`,
    detail: { cleaner: opts.cleanerName, shift_date: opts.shiftDate, remaining: opts.remaining, required: opts.required },
    source: opts.source,
    shift_id: opts.shiftId ?? undefined,
    cleaner_id: opts.cleanerId ?? undefined,
    triggered_by: opts.triggeredBy ?? "webhook",
  });
}

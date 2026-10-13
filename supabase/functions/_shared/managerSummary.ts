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
import { hoursUntilShift, prettyDate, prettyTime } from "./datetime.ts";
import { renderTemplate } from "./templates.ts";
import { loadNotificationSwitches } from "./settings.ts";
import { writeAuditLog } from "./auditLog.ts";

// The app base URL for the "open this shift" link in roster-change notes. Same env
// + default as confirm-reminder. The Dashboard reads ?edit=<shiftId> and opens
// that shift's drawer (Confirm + Edit Roster), so the link lands the manager right
// on the shift that changed.
function shiftLink(shiftId?: string | null): string {
  const base = (Deno.env.get("APP_URL") ?? "https://wybalena-housekeeping-ops.vercel.app").replace(/\/$/, "");
  return shiftId ? `${base}/?edit=${shiftId}` : base;
}

// How close to the shift counts as "final 24h". A roster change (a cleaner drops
// off or a late acceptance fills a spot) this close is worth telling the manager
// about immediately, because there's no time left for the normal flow to settle it
// before the day-before roster — or the roster has already gone out.
const ROSTER_CHANGE_WINDOW_HOURS = 24;

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

// Canonical clean-type labels cleaners and the manager actually read — the same
// wording the app shows (src/lib/format.ts SHIFT_TYPE_LABEL). A raw enum like
// "standard" or a bare "Standard" is never what should appear in a message; it is
// "Standard Clean", "Deep Clean", etc. Shared by notify-manager-roster and the
// roster summary so clean-type display has one source of truth.
const SHIFT_TYPE_LABEL: Record<string, string> = {
  standard: "Standard Clean",
  mid_retreat: "Mid-Retreat Clean",
  deep_full_venue: "Deep Clean",
  wipeover: "Wipeover Clean",
  other: "Other",
};

// Exported so every message renders the same clean-type label. Falls back to a
// title-cased version of the raw value for any type not in the map, so a new enum
// value degrades to something readable rather than throwing.
export function prettyType(t: string): string {
  return SHIFT_TYPE_LABEL[t] ?? (t ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Build the day-before roster message: one block per shift with date/time, type
// and every confirmed cleaner. Shifts with nobody confirmed are still listed so
// the lead can chase them.
//
// Each per-shift block is rendered through the EDITABLE `lead_roster_block`
// template, so the venue can change the block's layout, emoji and spacing from the
// Message Templates page (e.g. move the time onto its own line, drop the broom
// emoji, add a blank line before the cleaners). Only the dynamic pieces stay
// code-owned: the formatted date/time/type and the bullet list of cleaners, which
// are passed in as variables. `{{cleaner_list}}` is the already-formatted list (or
// the "nobody confirmed" line) so a template author never has to loop.
//
// Falls back to the built-in block layout if the template row is missing, so the
// message can never fail to send. Async now because it loads the template.
export async function buildRosterBlocks(
  sb: SupabaseClient,
  rosters: ShiftRoster[],
): Promise<string> {
  const blocks = await Promise.all(rosters.map(async (r) => {
    const cleanerList = r.names.length
      ? r.names.map((n) => `   • ${n}`).join("\n")
      : "⚠️ No cleaners confirmed yet.";
    // The whole cleaners section, ready to drop in: the "N confirmed:" header +
    // list when someone's on it, or just the warning line when nobody is. A
    // template author who doesn't want to handle the empty case can use this one
    // variable and get sensible output either way.
    const cleanerBlock = r.names.length
      ? `👥 ${r.names.length} cleaner(s) confirmed:\n${cleanerList}`
      : cleanerList;
    // Built-in fallback keeps the original single-block layout exactly.
    const time = r.startTime ? ` · ⏰ ${prettyTime(r.startTime)}` : "";
    const fallback = `📅 ${prettyDate(r.shiftDate)}${time}\n🧹 ${prettyType(r.shiftType)}\n${cleanerBlock}`;
    return await renderTemplate(sb, "lead_roster_block", fallback, {
      shift_date: prettyDate(r.shiftDate),
      start_time: r.startTime ? prettyTime(r.startTime) : "",
      shift_type: prettyType(r.shiftType),
      cleaner_count: r.names.length,
      cleaner_list: cleanerList,
      cleaner_block: cleanerBlock,
    });
  }));
  return blocks.join("\n\n");
}

export async function buildLeadRoster(
  sb: SupabaseClient,
  rosters: ShiftRoster[],
): Promise<string> {
  const total = rosters.reduce((n, r) => n + r.names.length, 0);
  return (
    `*Tomorrow's Roster* 📋\n\n` +
    (await buildRosterBlocks(sb, rosters)) +
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
  const text = await renderTemplate(sb, "lead_roster", await buildLeadRoster(sb, rosters), {
    shift_blocks: await buildRosterBlocks(sb, rosters),
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
    // Whether the cancellation was URGENT (within the 72h window, re-offered
    // immediately) or DEFERRED (plenty of notice, waits for the 3pm run). The
    // venue only wants Zara pinged for urgent, last-minute cancellations — a
    // cancellation weeks out is handled quietly by the 3pm run and doesn't need
    // her attention. Absent (e.g. a caller that predates this) is treated as
    // urgent, so a miss errs toward telling her rather than staying silent.
    urgent?: boolean;
    source: string;
    triggeredBy?: "webhook" | "manual" | "cron";
  },
): Promise<void> {
  // Admin switch (Schedule page -> Event notifications). Checked BEFORE the
  // lookup so turning it off costs nothing and sends nothing. Defaults to ON, so
  // a missing setting reproduces the pre-setting behaviour.
  const switches = await loadNotificationSwitches(sb);
  if (!switches.leadCleanerCancelled) return;

  // Only urgent (within-72h) cancellations reach Zara. A deferred one has plenty
  // of notice and is re-offered by the 3pm run, so it isn't hers to chase. `false`
  // is the only value that suppresses — undefined stays ON, per the switch's own
  // "a silent miss is worse than an unexpected send" contract.
  if (opts.urgent === false) return;

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

// Short "the roster for a shift in the next 24h has changed" note to the Cleaning
// Manager, with a link to open that shift. Fires when a cleaner drops off OR a late
// acceptance fills a spot inside the final 24h — the window where the day-before
// roster has gone out (or is about to) and she needs to know without waiting for
// the next summary. Outside 24h this is a silent no-op (the normal flow / the 3pm
// re-offer handles it and she'll see it on the day-before roster).
//
// Gated on its own switch (leadRosterChange24h, Schedule page) so it can be turned
// off independently of the urgent-cancellation alert. Silent no-op with no active
// team lead or no phone.
export async function notifyLeadRosterChange(
  sb: SupabaseClient,
  opts: {
    kind: "dropped" | "joined";   // a cleaner left the shift, or newly accepted it
    cleanerName: string;
    shiftDate: string;            // YYYY-MM-DD
    startTime: string;            // HH:MM(:SS)
    shiftType?: string | null;
    shiftId?: string | null;
    cleanerId?: string | null;
    remaining?: number | null;    // cleaners now confirmed
    required?: number | null;     // cleaners the shift needs
    source: string;
    triggeredBy?: "webhook" | "manual" | "cron";
  },
): Promise<void> {
  const switches = await loadNotificationSwitches(sb);
  if (!switches.leadRosterChange24h) return;

  // Only within the final 24h before the shift. hoursUntilShift is DST-aware and
  // returns +Infinity on a malformed date, so a bad row never counts as "within".
  const hoursOut = hoursUntilShift(opts.shiftDate, opts.startTime);
  if (!(hoursOut >= 0 && hoursOut <= ROSTER_CHANGE_WINDOW_HOURS)) return;

  const { data: lead } = await sb
    .from("profiles").select("phone").eq("role", "team_leader").eq("is_active", true).limit(1).maybeSingle();
  if (!lead?.phone) return;

  const when = `${prettyDate(opts.shiftDate)} at ${prettyTime(opts.startTime)}`;
  const type = opts.shiftType ? `${prettyType(opts.shiftType)} · ` : "";
  const count = opts.remaining != null && opts.required != null
    ? ` (now ${opts.remaining}/${opts.required})`
    : "";
  const verb = opts.kind === "dropped" ? "has dropped off" : "has joined";
  const link = shiftLink(opts.shiftId);

  const fallback =
    `🔄 *Roster update — tomorrow's shift*\n\n` +
    `${opts.cleanerName} ${verb} the ${type}${when} shift${count}.\n\n` +
    `View the shift: ${link}`;

  const text = await renderTemplate(sb, "lead_roster_change", fallback, {
    cleaner_name: opts.cleanerName,
    change: verb,
    shift_type: opts.shiftType ? prettyType(opts.shiftType) : "",
    shift_date: prettyDate(opts.shiftDate),
    start_time: prettyTime(opts.startTime),
    remaining: opts.remaining ?? "",
    required: opts.required ?? "",
    shift_link: link,
  });

  const sent = await sendMessage(lead.phone, text);
  await writeAuditLog(sb, {
    event_type: "notification.lead_roster_change",
    event_label: "Team Lead Notified",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `Team lead sent a roster-change note — ${opts.cleanerName} ${verb} the ${when} shift (within 24h).`
      : `Failed to send the roster-change note to the team lead for the ${when} shift.`,
    detail: { kind: opts.kind, cleaner: opts.cleanerName, shift_date: opts.shiftDate, remaining: opts.remaining, required: opts.required },
    source: opts.source,
    shift_id: opts.shiftId ?? undefined,
    cleaner_id: opts.cleanerId ?? undefined,
    triggered_by: opts.triggeredBy ?? "webhook",
  });
}

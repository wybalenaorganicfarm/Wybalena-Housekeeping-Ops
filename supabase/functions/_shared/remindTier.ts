// Non-responder reminders.
//
// Two callers, one send path:
//   • remindTier()         — the weekly cron jobs (remind-tier-1/2/3). Reminds
//                            every open offer at one tier across the WEEKLY track.
//   • remindShiftsAtTier() — staffing-catchup, for the catchup-track shifts whose
//                            own 24h clock says they are due.
//
// A shift belongs to exactly one track (shifts.staffing_track), so the two
// callers can never remind the same offer. See
// supabase/migrations/20260819120000_staffing_track.sql.
//
// Three rules keep this from flooding a cleaner:
//
//   1. An offer is reminded at most ONCE — reminder_sent_at is stamped.
//
//   2. An offer is only reminded while the shift is STILL at that tier. Without
//      this, offers the shift had already escalated past stayed queued for weeks
//      and all fired on the next weekly run — the 17 August burst.
//
//   3. ONE MESSAGE PER CLEANER PER RUN, however many offers they owe a reply on.
//      Rule 2 cannot help here: a Tier 3 cleaner legitimately holding five
//      unanswered Tier 3 offers was sent five separate reminders on 19 August,
//      which looks exactly like the bug rules 1 and 2 fix. The message names the
//      shift — one date if they owe one reply, a bulleted list if they owe
//      several — but carries no offer code and no buttons of its own, because
//      accepting and declining is done on the buttons of the original offer.
//      See supabase/migrations/20260820140000_reminder_wording.sql.
//
// WHAT COUNTS AS UNANSWERED: status = 'offered', and nothing else. Accepted,
// declined, cancelled and closed offers are excluded by that filter, so they can
// never be chased. Note that tapping Decline does NOT decline: whatsapp-inbound
// asks "are you sure?" and the row stays `offered` until the cleaner taps Yes.
// That is intended — a stray tap must not drop them off a shift — so an
// unconfirmed decline is still an open offer and is still reminded. Only the
// confirmed Yes makes it a response.
//
// Inactive cleaners are skipped entirely and NOT stamped, so their offer stays
// remindable if they are reactivated.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { fillVars, loadTemplate } from "./templates.ts";
import { prettyDate } from "./datetime.ts";
import { writeAuditLog } from "./auditLog.ts";
import type { StaffingTrack } from "./engine.ts";

export type Tier = "tier_1" | "tier_2" | "tier_3";

const TIER_WORD: Record<Tier, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

// Sent when a template row is missing for any reason. Same wording as the seeded
// defaults, so a template outage doesn't change what cleaners read.
const DEFAULT_ONE = "Please respond to the shift offer we have sent you for the {{shift_date}} cleaning shift.";
const DEFAULT_MANY = "Please respond to the shift offers we have sent you for these cleaning shifts:\n\n{{shift_dates}}";

// The columns every reminder pass needs, plus the parent shift (inner-joined so
// the shift's own tier/track can be filtered on).
const PENDING_COLS =
  "id, cleaner_id, shift_id, shifts!inner(shift_date, start_time, current_tier, staffing_track)";

interface PendingRow {
  id: string;
  cleaner_id: string;
  shift_id: string;
  shifts?: { shift_date?: string } | null;
}

export interface ReminderResult {
  reminded: number;   // offers chased
  names: string[];    // cleaners messaged (one entry each, however many offers)
}

// Send the reminders owed, at most one WhatsApp per cleaner. Shared by both
// callers so the message, the once-only stamp and the audit trail are identical.
async function sendReminders(
  sb: SupabaseClient,
  pending: PendingRow[],
  tier: Tier,
  source: string,
  label: string,
): Promise<ReminderResult> {
  if (pending.length === 0) return { reminded: 0, names: [] };

  // Group first, send second — this grouping is the whole point of rule 3.
  const byCleaner = new Map<string, PendingRow[]>();
  for (const a of pending) {
    const list = byCleaner.get(a.cleaner_id);
    if (list) list.push(a);
    else byCleaner.set(a.cleaner_id, [a]);
  }

  const one = await loadTemplate(sb, "reminder_nonresponder");
  const many = await loadTemplate(sb, "reminder_nonresponder_multi");

  let reminded = 0;
  const names: string[] = [];
  for (const [cleanerId, rows] of byCleaner) {
    const { data: cleaner } = await sb
      .from("cleaners").select("full_name, phone, is_active").eq("id", cleanerId).maybeSingle();
    // Don't remind a cleaner who is currently Inactive. Skip entirely (no
    // stamp) so the offer can still be reminded if they reactivate later.
    if (!cleaner?.is_active) continue;

    // `rows` arrives soonest-shift-first and Map preserves insertion order, so
    // the list reads chronologically.
    const dates = rows.map((r) => prettyDate(r.shifts?.shift_date ?? ""));
    const body = rows.length > 1
      ? fillVars(many?.body ?? DEFAULT_MANY, { shift_dates: dates.map((d) => `• ${d}`).join("\n") })
      : fillVars(one?.body ?? DEFAULT_ONE, { shift_date: dates[0] });

    if (cleaner.phone) await sendMessage(cleaner.phone, body);

    // Stamp every offer this one message covered, in a single write.
    await sb.from("shift_assignments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));

    reminded += rows.length;
    names.push(cleaner.full_name ?? "cleaner");

    // One audit row per OFFER, so every shift keeps its own trail on /logs and in
    // the shift drawer — the cleaner got one message, but this chased N offers.
    const note = rows.length > 1
      ? ` One message covered ${rows.length} unanswered offers: ${dates.join("; ")}.`
      : "";
    for (const r of rows) {
      await writeAuditLog(sb, {
        event_type: "reminder.nonresponder_sent",
        event_label: label,
        status: "success",
        summary: `WhatsApp reminder sent to ${cleaner.full_name ?? "cleaner"} (${TIER_WORD[tier]}) — no response to offer for shift on ${prettyDate(r.shifts?.shift_date ?? "")}.${note}`,
        detail: { assignment_id: r.id, shift_id: r.shift_id, tier, offers_in_message: rows.length },
        source,
        shift_id: r.shift_id,
        cleaner_id: cleanerId,
        triggered_by: "cron",
      });
    }
  }
  return { reminded, names };
}

// Weekly cron pass: every unanswered, unreminded offer at `tier`, on the weekly
// track, for shifts still sitting at that tier.
export async function remindTier(
  sb: SupabaseClient,
  tier: Tier,
  track: StaffingTrack = "weekly",
): Promise<number> {
  const source = `remind-${tier.replace("_", "-")}`;
  const label = `${TIER_WORD[tier]} Non-Responder Reminders`;

  // No age filter — this job's cron slot decides WHEN reminders go out. What it
  // does filter is RELEVANCE: the shift must still be at this tier, and must be
  // on this chain. Without those two, offers the shift escalated past weeks ago
  // stayed queued and all fired together on the next weekly run.
  const { data: pending } = await sb
    .from("shift_assignments")
    .select(PENDING_COLS)
    .eq("status", "offered")
    .eq("tier_at_offer", tier)
    .is("reminder_sent_at", null)
    .eq("shifts.current_tier", tier)
    .eq("shifts.staffing_track", track)
    // Soonest shift first — keeps the audit trail chronological.
    .order("shift_date", { referencedTable: "shifts" });

  const { reminded, names } = await sendReminders(sb, (pending ?? []) as PendingRow[], tier, source, label);

  if (reminded === 0) {
    // Distinguish "nobody at this tier is awaiting a reply" from "offers exist
    // but were all already reminded" — same scope as the send query above.
    const { data: open } = await sb
      .from("shift_assignments")
      .select("id, shifts!inner(current_tier, staffing_track)")
      .eq("status", "offered")
      .eq("tier_at_offer", tier)
      .eq("shifts.current_tier", tier)
      .eq("shifts.staffing_track", track);
    const openOffers = (open ?? []).length;
    const summary = openOffers === 0
      ? `No ${TIER_WORD[tier]} cleaners have an open offer awaiting a reply. No reminders needed.`
      : `${openOffers} open ${TIER_WORD[tier]} offer(s) exist, but all have already been reminded. No new reminders sent.`;
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_skipped",
      event_label: label,
      status: "skipped",
      summary,
      detail: { open_offers: openOffers, tier, track },
      source,
      triggered_by: "cron",
    });
  } else {
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_run",
      event_label: label,
      status: "success",
      summary: `${reminded} unanswered ${TIER_WORD[tier]} offer(s) chased in ${names.length} message(s) to: ${names.join(", ")}.`,
      detail: { reminded, cleaners: names, tier, track },
      source,
      triggered_by: "cron",
    });
  }

  return reminded;
}

// staffing-catchup pass: the reminder step for the catchup-track shifts that are
// due today at `tier`. Takes them all at once so a cleaner owed reminders on
// several of those shifts still receives ONE message.
export async function remindShiftsAtTier(
  sb: SupabaseClient,
  shiftIds: string[],
  tier: Tier,
  source: string,
  label: string,
): Promise<ReminderResult> {
  if (shiftIds.length === 0) return { reminded: 0, names: [] };
  const { data: pending } = await sb
    .from("shift_assignments")
    .select(PENDING_COLS)
    .in("shift_id", shiftIds)
    .eq("status", "offered")
    .eq("tier_at_offer", tier)
    .is("reminder_sent_at", null)
    .eq("shifts.current_tier", tier)
    .order("shift_date", { referencedTable: "shifts" });

  return await sendReminders(sb, (pending ?? []) as PendingRow[], tier, source, label);
}

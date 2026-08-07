// Non-responder reminders, shared by the three per-tier cron jobs
// (remind-tier-1 / remind-tier-2 / remind-tier-3).
//
// Each tier is scheduled independently from /schedule, so an admin can chase a
// Tier 1 offer sooner than a Tier 3 one. The logic is identical per tier — only
// the `tier_at_offer` filter differs — so it lives here rather than being copied
// three times.
//
// An offer is reminded at most ONCE (reminder_sent_at is stamped), and only
// while it is still open and the cleaner is active.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { fillVars, loadTemplate } from "./templates.ts";
import { prettyDate } from "./datetime.ts";
import { writeAuditLog } from "./auditLog.ts";

export type Tier = "tier_1" | "tier_2" | "tier_3";

const TIER_WORD: Record<Tier, string> = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

export async function remindTier(sb: SupabaseClient, tier: Tier): Promise<number> {
  const source = `remind-${tier.replace("_", "-")}`;
  const label = `${TIER_WORD[tier]} Non-Responder Reminders`;

  // Offered to THIS tier, not yet responded, not yet reminded. No age filter —
  // the cron schedule decides when this tier's reminders go out.
  const { data: pending } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id, offer_code, shift_id, shifts(shift_date, start_time)")
    .eq("status", "offered")
    .eq("tier_at_offer", tier)
    .is("reminder_sent_at", null);

  const tmpl = await loadTemplate(sb, "reminder_nonresponder");

  let reminded = 0;
  for (const a of pending ?? []) {
    const { data: cleaner } = await sb
      .from("cleaners").select("full_name, phone, is_active").eq("id", a.cleaner_id).maybeSingle();
    // Don't remind a cleaner who is currently Inactive. Skip entirely (no
    // stamp) so the offer can still be reminded if they reactivate later.
    if (!cleaner?.is_active) continue;
    const sh = (a as Record<string, unknown>).shifts as { shift_date?: string } | undefined;
    if (cleaner.phone) {
      const shiftDate = prettyDate(sh?.shift_date ?? "");
      await sendMessage(
        cleaner.phone,
        tmpl?.body
          ? fillVars(tmpl.body, { shift_date: shiftDate })
          : `Reminder: please respond to the cleaning shift offer on ${shiftDate}.\n` +
            `Tap Accept or Decline on the offer.`,
      );
    }
    await sb.from("shift_assignments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", a.id);
    reminded++;
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_sent",
      event_label: label,
      status: "success",
      summary: `WhatsApp reminder sent to ${cleaner.full_name ?? "cleaner"} (${TIER_WORD[tier]}) — no response to offer for shift on ${prettyDate(sh?.shift_date ?? "")}.`,
      detail: { assignment_id: a.id, shift_id: a.shift_id, tier },
      source,
      shift_id: a.shift_id,
      cleaner_id: a.cleaner_id,
      triggered_by: "cron",
    });
  }

  if (reminded === 0) {
    // Distinguish "nobody at this tier has an open offer" from "offers exist but
    // were all already reminded".
    const { count: openOffers } = await sb
      .from("shift_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "offered")
      .eq("tier_at_offer", tier);
    const summary = (openOffers ?? 0) === 0
      ? `No ${TIER_WORD[tier]} cleaners have an open offer awaiting a reply. No reminders needed.`
      : `${openOffers} open ${TIER_WORD[tier]} offer(s) exist, but all have already been reminded. No new reminders sent.`;
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_skipped",
      event_label: label,
      status: "skipped",
      summary,
      detail: { open_offers: openOffers ?? 0, tier },
      source,
      triggered_by: "cron",
    });
  }

  return reminded;
}

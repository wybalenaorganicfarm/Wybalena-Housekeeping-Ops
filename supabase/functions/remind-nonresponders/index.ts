// remind-nonresponders — cron (admin-scheduled). WhatsApp reminder to offered
// cleaners who haven't responded and haven't already been reminded; stamps
// reminder_sent_at. No internal delay — the admin controls timing via the
// schedule (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { fillVars, loadTemplate } from "../_shared/templates.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "remind-nonresponders";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  // Offered but not yet responded and not yet reminded — no age filter; the
  // schedule decides when reminders go out.
  const { data: pending } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id, offer_code, shift_id, shifts(shift_date, start_time)")
    .eq("status", "offered")
    .is("reminder_sent_at", null);

  const tmpl = await loadTemplate(sb, "reminder_nonresponder");

  let reminded = 0;
  for (const a of pending ?? []) {
    const { data: cleaner } = await sb
      .from("cleaners").select("full_name, phone, is_active").eq("id", a.cleaner_id).maybeSingle();
    // Don't remind a cleaner who is currently Away/Inactive. Skip entirely (no
    // stamp) so the offer can still be reminded if they reactivate later.
    if (!cleaner?.is_active) continue;
    const sh = (a as Record<string, any>).shifts;
    if (cleaner?.phone) {
      const shiftDate = sh?.shift_date ?? "";
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
      event_label: "Non-Responder Reminders",
      status: "success",
      summary: `WhatsApp reminder sent to ${cleaner?.full_name ?? "cleaner"} — no response to offer for shift on ${sh?.shift_date ?? "—"}.`,
      detail: { assignment_id: a.id, shift_id: a.shift_id },
      source: SOURCE,
      shift_id: a.shift_id,
      cleaner_id: a.cleaner_id,
      triggered_by: "cron",
    });
  }

  if (reminded === 0) {
    // Distinguish "nobody has an open offer" from "offers exist but were all
    // already reminded".
    const { count: openOffers } = await sb
      .from("shift_assignments")
      .select("id", { count: "exact", head: true })
      .eq("status", "offered");
    const summary = (openOffers ?? 0) === 0
      ? "No cleaners have an open offer awaiting a reply. No reminders needed."
      : `${openOffers} open offer(s) exist, but all have already been reminded. No new reminders sent.`;
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_skipped",
      event_label: "Non-Responder Reminders",
      status: "skipped",
      summary,
      detail: { open_offers: openOffers ?? 0 },
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, reminded });
});

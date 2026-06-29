// remind-nonresponders — cron: hourly. WhatsApp reminder to offered cleaners
// with no response 18h after the offer; stamps reminder_sent_at (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "remind-nonresponders";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  const cutoff = new Date(Date.now() - 18 * 3600_000).toISOString();
  const { data: pending } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id, offer_code, shift_id, shifts(shift_date, start_time)")
    .eq("status", "offered")
    .is("reminder_sent_at", null)
    .lte("offered_at", cutoff);

  let reminded = 0;
  for (const a of pending ?? []) {
    const { data: cleaner } = await sb
      .from("cleaners").select("full_name, phone").eq("id", a.cleaner_id).maybeSingle();
    const sh = (a as Record<string, any>).shifts;
    if (cleaner?.phone) {
      await sendMessage(
        cleaner.phone,
        `Reminder: please respond to the cleaning shift offer on ${sh?.shift_date ?? ""}.\n` +
          `Reply YES ${a.offer_code} / NO ${a.offer_code}.`,
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
    await writeAuditLog(sb, {
      event_type: "reminder.nonresponder_skipped",
      event_label: "Non-Responder Reminders",
      status: "skipped",
      summary: "No non-responding cleaners found past 18 hours. No reminders needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, reminded });
});

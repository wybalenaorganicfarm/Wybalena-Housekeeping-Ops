// pre-shift-reminder — cron: daily 06:30 IST testing (01:00 UTC); go-live tz TBD.
// For shifts happening tomorrow, WhatsApp all accepted cleaners (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "pre-shift-reminder";

// "Tomorrow" in venue-local time. TESTING: Asia/Calcutta (IST). GO-LIVE: swap to
// the confirmed Australian venue tz.
function localDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d); // YYYY-MM-DD
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const tomorrow = localDateStr(new Date(Date.now() + 86400000));

  const { data: shifts } = await sb
    .from("shifts")
    .select("id, shift_date, start_time, shift_type")
    .eq("shift_date", tomorrow)
    .in("status", ["staffing", "fully_staffed", "confirmed"]);

  if ((shifts ?? []).length === 0) {
    await writeAuditLog(sb, {
      event_type: "reminder.preshift_skipped",
      event_label: "Pre-Shift Reminders",
      status: "skipped",
      summary: "No shifts tomorrow. No pre-shift reminders needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: true, reminders: 0 });
  }

  let messaged = 0;
  for (const s of shifts ?? []) {
    const { data: accepted } = await sb
      .from("shift_assignments")
      .select("cleaner_id")
      .eq("shift_id", s.id)
      .eq("status", "accepted");
    let shiftMessaged = 0;
    for (const a of accepted ?? []) {
      const { data: c } = await sb
        .from("cleaners").select("phone").eq("id", a.cleaner_id).maybeSingle();
      if (c?.phone) {
        await sendMessage(
          c.phone,
          `Reminder: your ${s.shift_type} clean is tomorrow (${s.shift_date}) at ${s.start_time}. See you there!`,
        );
        messaged++;
        shiftMessaged++;
      }
    }
    await writeAuditLog(sb, {
      event_type: "reminder.preshift_sent",
      event_label: "Pre-Shift Reminders",
      status: "success",
      summary: `Pre-shift reminder sent to ${shiftMessaged} cleaner(s) for tomorrow's shift on ${s.shift_date}.`,
      detail: { shift_id: s.id, cleaners_messaged: shiftMessaged },
      source: SOURCE,
      shift_id: s.id,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, reminders: messaged });
});

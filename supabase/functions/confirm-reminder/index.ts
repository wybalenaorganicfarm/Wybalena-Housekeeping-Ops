// confirm-reminder — cron. Reminds Ashley about EVERY shift still awaiting
// confirmation, raising an unconfirmed_shifts alert per shift + one summary email.
// No internal age check: the admin controls cadence purely through the schedule,
// so whenever this runs it reminds about all currently-pending shifts.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { reminderEmail } from "../_shared/emailTemplates.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "confirm-reminder";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  // Every shift still awaiting confirmation — no created_at filter; the schedule
  // decides when reminders go out.
  const { data: pending } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type")
    .eq("status", "pending_confirmation");

  let raised = 0;
  for (const s of pending ?? []) {
    // Dedupe: one open unconfirmed_shifts alert per shift.
    const { data: dup } = await sb
      .from("alerts")
      .select("id")
      .eq("alert_type", "unconfirmed_shifts")
      .eq("shift_id", s.id)
      .eq("status", "open")
      .maybeSingle();
    if (dup) continue;

    await sb.from("alerts").insert({
      alert_type: "unconfirmed_shifts",
      shift_id: s.id,
      title: "Shift still unconfirmed",
      body: `A ${s.shift_type} shift on ${s.shift_date} is still awaiting confirmation.`,
    });
    raised++;
  }

  if (raised === 0) {
    // Two different reasons to send nothing — report the accurate one:
    //   • no pending shifts at all, or
    //   • pending shifts exist but every one was already reminded (open alert),
    //     which is why no email goes out a second time.
    const pendingCount = pending?.length ?? 0;
    const summary = pendingCount === 0
      ? "No shifts awaiting confirmation. No reminder needed."
      : `${pendingCount} shift(s) are awaiting confirmation, but a reminder was already sent for each — no duplicate reminder sent.`;
    await writeAuditLog(sb, {
      event_type: "reminder.confirmation_skipped",
      event_label: "Confirmation Reminder",
      status: "skipped",
      summary,
      detail: pendingCount ? { awaiting_confirmation: pendingCount, already_reminded: pendingCount } : undefined,
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: true, raised });
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "https://wybalena-housekeeping-ops.vercel.app").replace(/\/$/, "");
  const email = reminderEmail({ count: raised, shiftsUrl: `${appUrl}/shifts` });
  const sent = await sendEmail(email.subject, email.text, undefined, email.html);
  await writeAuditLog(sb, {
    event_type: "reminder.confirmation_sent",
    event_label: "Confirmation Reminder",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `Confirmation reminder sent to Ashley — ${raised} shift(s) still awaiting confirmation.`
      : "Failed to send confirmation reminder email to Ashley. Error: email provider returned an error.",
    error_message: sent.ok ? undefined : "email provider returned an error",
    detail: { pending: raised },
    source: SOURCE,
    triggered_by: "cron",
  });

  return json({ ok: true, raised });
});

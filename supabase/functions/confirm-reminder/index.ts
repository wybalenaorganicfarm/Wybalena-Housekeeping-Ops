// confirm-reminder — cron: hourly. If a shift is still pending_confirmation
// ~5h after creation, raise an unconfirmed_shifts alert + email Ashley (Spec §2, §7.1).
// Runs hourly and evaluates the +5h condition in code (pg_cron is wall-clock).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "confirm-reminder";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const sb = serviceClient();

  const cutoff = new Date(Date.now() - 5 * 3600_000).toISOString();
  const { data: stale } = await sb
    .from("shifts")
    .select("id, shift_date, shift_type, created_at")
    .eq("status", "pending_confirmation")
    .lte("created_at", cutoff);

  let raised = 0;
  for (const s of stale ?? []) {
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
      body: `A ${s.shift_type} shift on ${s.shift_date} has been pending for 5+ hours.`,
    });
    raised++;
  }

  if (raised === 0) {
    await writeAuditLog(sb, {
      event_type: "reminder.confirmation_skipped",
      event_label: "Confirmation Reminder",
      status: "skipped",
      summary: "No unconfirmed shifts found older than 5 hours. No reminder needed.",
      source: SOURCE,
      triggered_by: "cron",
    });
    return json({ ok: true, raised });
  }

  const sent = await sendEmail(
    `Wybalena: ${raised} shift(s) still need confirming`,
    `${raised} auto-created shift(s) have been pending confirmation for over 5 hours. ` +
      `Please review them in the app.`,
  );
  await writeAuditLog(sb, {
    event_type: "reminder.confirmation_sent",
    event_label: "Confirmation Reminder",
    status: sent.ok ? "success" : "failed",
    summary: sent.ok
      ? `Confirmation reminder sent to Ashley — ${raised} shift(s) still pending after 5 hours.`
      : "Failed to send confirmation reminder email to Ashley. Error: email provider returned an error.",
    error_message: sent.ok ? undefined : "email provider returned an error",
    detail: { pending: raised },
    source: SOURCE,
    triggered_by: "cron",
  });

  return json({ ok: true, raised });
});

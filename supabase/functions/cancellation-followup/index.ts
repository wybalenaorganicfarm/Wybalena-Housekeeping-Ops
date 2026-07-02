// cancellation-followup — cron: daily 09:00 IST testing (03:30 UTC); go-live tz TBD.
// For open booking_cancelled alerts unactioned >=3 days, re-remind Ashley (Spec §2, §7.1).
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendEmail } from "../_shared/adapters/email.ts";
import { opsManager } from "../_shared/admin.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "cancellation-followup";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();

  const { data: stale } = await sb
    .from("alerts")
    .select("id, title, created_at, booking_id")
    .eq("alert_type", "booking_cancelled")
    .eq("status", "open")
    .lte("created_at", cutoff);

  const opsEmail = (stale ?? []).length ? (await opsManager(sb)).email ?? undefined : undefined;
  for (const a of stale ?? []) {
    await sendEmail(
      "Wybalena: cancellation still needs review",
      `A booking cancellation has been awaiting your review for 3+ days: "${a.title}". ` +
        `Please confirm or dismiss it in the app.`,
      opsEmail,
    );
    await writeAuditLog(sb, {
      event_type: "followup.cancellation_sent",
      event_label: "Cancellation Follow-up",
      status: "success",
      summary: "Follow-up sent to Ashley — booking cancellation alert still unactioned after 3 days.",
      detail: { alert_id: a.id },
      source: SOURCE,
      booking_id: a.booking_id ?? undefined,
      triggered_by: "cron",
    });
  }

  if ((stale ?? []).length === 0) {
    await writeAuditLog(sb, {
      event_type: "followup.cancellation_skipped",
      event_label: "Cancellation Follow-up",
      status: "skipped",
      summary: "No unactioned booking cancellation alerts older than 3 days.",
      source: SOURCE,
      triggered_by: "cron",
    });
  }

  return json({ ok: true, followedUp: (stale ?? []).length });
});

// notify-manager-roster — cron (~15 min). Sends the Cleaning Manager the pure
// "you've been rostered" WhatsApp for every roster row she hasn't been told about.
//
// The roster row itself is created by the trg_roster_manager trigger (status
// 'team_lead', lead_notified_at null) on shift INSERT, and backfilled onto
// existing upcoming shifts by set-manager on nomination. This job ONLY messages
// and stamps — it never rosters. It is a NOTIFICATION, not an offer: plain
// sendMessage, no buttons, and status stays 'team_lead' so acceptedCount ignores
// it (no staffing effect).
//
// Idempotent by design: it selects only rows with lead_notified_at IS NULL and
// stamps lead_notified_at after each send, so a re-run — or the next 15-min tick —
// never messages the same roster row twice. A send failure leaves the stamp null
// so the row is retried next tick (accepting a rare duplicate over a silent miss).
//
// No shared-row contention with escalate-*/offer-*: those touch offer-status rows
// (offered/accepted/...), this touches only status='team_lead' rows, and no other
// job writes lead_notified_at.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { prettyDate, prettyTime } from "../_shared/datetime.ts";
import { prettyType } from "../_shared/managerSummary.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "notify-manager-roster";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();

  // Roster rows the manager hasn't been told about yet. Embed the shift so we can
  // format type/date/time; a cancelled shift is filtered per-row below.
  const { data: pending } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id, shifts(shift_date, start_time, shift_type, status)")
    .eq("status", "team_lead")
    .is("lead_notified_at", null);

  let notified = 0;
  for (const row of pending ?? []) {
    const r = row as Record<string, any>;
    try {
      // PostgREST returns the to-one embed as an object, but can hand back an
      // array after a schema-cache blip — normalise (mirrors whatsapp-inbound).
      let sh = r.shifts;
      if (Array.isArray(sh)) sh = sh[0];
      if (!sh || sh.status === "cancelled") {
        // Stamp so a cancelled/missing shift's row isn't rescanned every tick.
        await sb.from("shift_assignments").update({ lead_notified_at: new Date().toISOString() }).eq("id", r.id);
        continue;
      }

      // The manager's cleaner row — phone + active state at send time.
      const { data: mgr } = await sb
        .from("cleaners").select("phone, is_active").eq("id", r.cleaner_id).maybeSingle();
      // No phone or inactive: don't message, but stamp so we don't retry forever.
      if (!mgr?.phone || !mgr.is_active) {
        await sb.from("shift_assignments").update({ lead_notified_at: new Date().toISOString() }).eq("id", r.id);
        continue;
      }

      // Vars MUST match the {{...}} names in the manager_rostered template, and be
      // display-formatted (prettyType/prettyDate/prettyTime) — never raw enum/ISO.
      // The fallback string uses the same formatting so template and fallback agree.
      const body = await renderTemplate(
        sb,
        "manager_rostered",
        `You've been rostered onto the ${prettyType(sh.shift_type)} clean on ${prettyDate(sh.shift_date)} at ${prettyTime(sh.start_time)}. No action needed — this is your confirmation.`,
        {
          shift_type: prettyType(sh.shift_type),
          shift_date: prettyDate(sh.shift_date),
          start_time: prettyTime(sh.start_time),
        },
      );

      const sent = await sendMessage(mgr.phone, body);
      // Only stamp on a successful send. A failure leaves lead_notified_at null so
      // the next tick retries — a rare duplicate is better than her never hearing.
      if (sent.ok) {
        await sb.from("shift_assignments").update({ lead_notified_at: new Date().toISOString() }).eq("id", r.id);
        notified++;
      } else {
        await writeAuditLog(sb, {
          event_type: "notification.manager_rostered",
          event_label: "Cleaning Manager Rostered",
          status: "failed",
          summary: `Could not send the roster notification to the Cleaning Manager for the shift on ${prettyDate(sh.shift_date)} — WhatsApp send failed. Will retry.`,
          detail: { assignment_id: r.id },
          source: SOURCE,
          triggered_by: "cron",
        });
      }
    } catch (e) {
      console.error(`[notify-manager-roster] failed for assignment ${r.id}: ${String(e)}`);
    }
  }

  return json({ ok: true, notified });
});

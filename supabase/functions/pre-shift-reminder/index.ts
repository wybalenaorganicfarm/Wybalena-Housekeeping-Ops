// pre-shift-reminder — cron: daily 06:30 IST testing (01:00 UTC); go-live tz TBD.
// For shifts happening tomorrow, WhatsApp all accepted cleaners (Spec §2, §7.1)
// and send the team lead ONE message with tomorrow's confirmed roster.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { fillVars, loadTemplate } from "../_shared/templates.ts";
import { prettyDate, prettyTime } from "../_shared/datetime.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";
import { notifyLeadRoster, prettyType, type ShiftRoster } from "../_shared/managerSummary.ts";

const SOURCE = "pre-shift-reminder";

// "Tomorrow" in venue-local time (Australia/Sydney, DST-aware).
function localDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
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
    .in("status", ["staffing", "fully_staffed", "confirmed"])
    // All on one date, so earliest start first.
    .order("start_time");

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

  const tmpl = await loadTemplate(sb, "reminder_preshift");

  let messaged = 0;
  // Tomorrow's confirmed roster per shift — sent to the team lead as one message
  // at the end of the run.
  const rosters: ShiftRoster[] = [];
  for (const s of shifts ?? []) {
    const { data: accepted } = await sb
      .from("shift_assignments")
      .select("cleaner_id")
      .eq("shift_id", s.id)
      .eq("status", "accepted");
    let shiftMessaged = 0;
    // Collect each confirmed cleaner with the fields needed to ORDER the roster:
    // the Cleaning Manager first, then Tier 1 → 2 → 3, alphabetical within a tier.
    // The venue reads top-down, so regular Tier 1 cleaners should head the list and
    // fill-ins from lower tiers sit beneath them.
    const roster: { name: string; isLead: boolean; tier: string }[] = [];
    for (const a of accepted ?? []) {
      const { data: c } = await sb
        .from("cleaners").select("full_name, phone, is_active, is_team_leader, tier").eq("id", a.cleaner_id).maybeSingle();
      // Rostered either way — the lead needs the full confirmed list, including
      // cleaners we can't WhatsApp.
      if (c?.full_name) roster.push({ name: c.full_name, isLead: !!c.is_team_leader, tier: c.tier ?? "tier_3" });
      // Don't send while the cleaner is currently Inactive.
      if (c?.phone && c.is_active) {
        await sendMessage(
          c.phone,
          tmpl?.body
            ? fillVars(tmpl.body, { shift_type: prettyType(s.shift_type), shift_date: prettyDate(s.shift_date), start_time: prettyTime(s.start_time) })
            : `Reminder: your ${prettyType(s.shift_type)} is tomorrow (${prettyDate(s.shift_date)}) at ${prettyTime(s.start_time)}. See you there!`,
        );
        messaged++;
        shiftMessaged++;
      }
    }
    // Manager first (rank 0), then by tier number, then alphabetical.
    const tierRank: Record<string, number> = { tier_1: 1, tier_2: 2, tier_3: 3 };
    const rosterNames = roster
      .sort((a, b) =>
        (a.isLead ? 0 : (tierRank[a.tier] ?? 9)) - (b.isLead ? 0 : (tierRank[b.tier] ?? 9)) ||
        a.name.localeCompare(b.name))
      .map((r) => r.name);
    rosters.push({
      shiftId: s.id,
      shiftDate: s.shift_date,
      startTime: (s.start_time ?? "").slice(0, 5),
      shiftType: s.shift_type,
      names: rosterNames,
    });
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

  // One WhatsApp to the team lead with tomorrow's confirmed roster — the only
  // staffing summary she receives, replacing the old per-tier-run messages.
  await notifyLeadRoster(sb, rosters, SOURCE);

  return json({ ok: true, reminders: messaged });
});

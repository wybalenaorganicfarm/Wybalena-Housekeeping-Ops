import { useEffect, useMemo, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Button, Modal, Spinner } from "../components/ui";
import {
  BOOKING_SYNC_RANGE_DEFAULT, BOOKING_SYNC_RANGE_LIMITS, getBookingSyncRange, getCronSchedules,
  getStaffingCatchup, STAFFING_CATCHUP_DEFAULT, STAFFING_CATCHUP_LIMITS, updateBookingSyncRange,
  updateCronSchedule, updateStaffingCatchup, type BookingSyncRange, type CronJob, type StaffingCatchup,
  getCancellationCooloff, updateCancellationCooloff, CANCELLATION_COOLOFF_DEFAULT,
  CANCELLATION_COOLOFF_LIMITS, type CancellationCooloff,
  getNotificationSwitches, updateNotificationSwitches, NOTIFICATION_SWITCHES_DEFAULT,
  type NotificationSwitches,
} from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import {
  describe, nextCronRun, parseCron, toCron, toTimeInput, WEEKDAY_SHORT, tzLabel,
  type Freq, type ScheduleForm,
} from "../lib/cron";

// Presentation metadata for each scheduled function. `order` drives display
// order; `group` splits the two sections. Keep in sync with the cron migration
// and manage-cron's KNOWN_FNS.
interface JobMeta { fn: string; label: string; desc: string; group: "weekly" | "daily"; order: number }
const META: JobMeta[] = [
  { fn: "sync-bookings", label: "Weekly Booking Sync", desc: "Pulls new and cancelled bookings from the calendar and creates the week's shifts.", group: "weekly", order: 1 },
  { fn: "confirm-reminder", label: "Confirmation Reminder", desc: "Nudges admins to confirm shifts that are still pending.", group: "weekly", order: 2 },
  // The five jobs below are one chain, in order. Each acts only on shifts this
  // chain started — a shift confirmed too late for the Tier 1 slot is handled
  // end to end by Staffing Catch-Up instead, so the two never drive the same shift.
  { fn: "offer-tier-1", label: "Tier 1 Offers", desc: "Sends the first round of shift offers to Tier 1 cleaners, for every shift confirmed since the last run.", group: "weekly", order: 3 },
  { fn: "remind-tier-1", label: "Tier 1 Non-Responder Reminders", desc: "Runs daily. Re-pings Tier 1 cleaners who were offered a shift and haven't replied — weekly-schedule and late-confirmed (catch-up) shifts alike. Each offer is reminded at most once.", group: "weekly", order: 4 },
  { fn: "escalate-tier-2", label: "Tier 2 Escalation", desc: "Runs daily. Opens shifts still unfilled at Tier 1 up to Tier 2 cleaners, once they've sat at Tier 1 for at least a day. Covers weekly-schedule and catch-up shifts.", group: "weekly", order: 5 },
  { fn: "remind-tier-2", label: "Tier 2 Non-Responder Reminders", desc: "Runs daily. Re-pings Tier 2 cleaners who were offered a shift and haven't replied. Each offer is reminded at most once.", group: "weekly", order: 6 },
  { fn: "escalate-tier-3", label: "Tier 3 Escalation", desc: "Runs daily. Opens shifts still unfilled at Tier 2 up to Tier 3 cleaners, once they've sat at Tier 2 for at least a day. Covers weekly-schedule and catch-up shifts.", group: "weekly", order: 7 },
  { fn: "remind-tier-3", label: "Tier 3 Non-Responder Reminders", desc: "Runs daily. Re-pings Tier 3 cleaners who were offered a shift and haven't replied. Each offer is reminded at most once.", group: "weekly", order: 8 },
  // Sit after the tier sequence — both are independent of the offer/escalation flow.
  { fn: "wipeover-notify", label: "Wipeover Cleaning Alert", desc: "Emails Ashleigh when a >3-day gap between bookings needs a wipeover clean.", group: "weekly", order: 9 },
  { fn: "mid-retreat-notify", label: "Mid-Retreat Cleaning Alert", desc: "Emails Ashleigh when a stay of 7+ nights needs a mid-retreat clean scheduled by hand.", group: "weekly", order: 10 },
  { fn: "staffing-catchup", label: "Staffing Catch-Up", desc: "Sends the first Tier 1 offer for any shift confirmed too late for the weekly Tier 1 slot. Its reminders and escalations then follow at the same scheduled per-tier times as every other shift. Shifts already on the weekly schedule are left alone.", group: "daily", order: 6.5 },
  { fn: "pre-shift-reminder", label: "Pre-Shift Reminders", desc: "Reminds assigned cleaners about tomorrow's shift and sends the team lead one roster summary.", group: "daily", order: 7 },
  { fn: "cancellation-followup", label: "Cancellation Follow-up", desc: "Handles guest cancellations and frees the affected shifts.", group: "daily", order: 8 },
  { fn: "health-check", label: "Connection Health Check", desc: "Checks that calendar, WhatsApp and email integrations are reachable.", group: "daily", order: 9 },
  { fn: "notify-manager-roster", label: "Cleaning Manager Roster Messages", desc: "Runs every 15 minutes. Sends each Cleaning Manager the \"you've been rostered onto this shift\" WhatsApp for any shift they haven't been told about yet. A notification only — no accept, and it doesn't fill a cleaner slot. Turn off to stop these messages without changing who is rostered.", group: "daily", order: 10 },
];

type Row = JobMeta & { schedule: string | null; active: boolean };

// The weekly sequence as an admin reads it, top to bottom. `understaffed-alert`
// is a real step in the chain but has no cron job of its own (it is raised
// inside the Tier 3 Escalation run), so it appears here and in the rendered
// list, but never in META / the cron table. Numbering is driven off THIS list so
// the alert gets its own number and the jobs after it stay in step.
const WEEKLY_STEPS = [
  "sync-bookings", "confirm-reminder", "offer-tier-1", "remind-tier-1",
  "escalate-tier-2", "remind-tier-2", "escalate-tier-3", "remind-tier-3",
  "understaffed-alert", "wipeover-notify", "mid-retreat-notify",
] as const;
// Returns undefined for anything missing from the list above, so a job added to
// META without a step here renders with NO number rather than a bogus "0".
const stepNo = (fn: string): number | undefined => {
  const i = WEEKLY_STEPS.indexOf(fn as typeof WEEKLY_STEPS[number]);
  return i === -1 ? undefined : i + 1;
};

export function Schedule() {
  const [jobs, setJobs] = useState<Record<string, CronJob>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [range, setRange] = useState<BookingSyncRange>(BOOKING_SYNC_RANGE_DEFAULT);
  const [editRange, setEditRange] = useState(false);
  const [catchup, setCatchup] = useState<StaffingCatchup>(STAFFING_CATCHUP_DEFAULT);
  const [editCatchup, setEditCatchup] = useState(false);
  const [cooloff, setCooloff] = useState<CancellationCooloff>(CANCELLATION_COOLOFF_DEFAULT);
  const [editCooloff, setEditCooloff] = useState(false);
  const [switches, setSwitches] = useState<NotificationSwitches>(NOTIFICATION_SWITCHES_DEFAULT);
  const [switchBusy, setSwitchBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [list, r, cu, co, sw] = await Promise.all([
        getCronSchedules(), getBookingSyncRange(), getStaffingCatchup(), getCancellationCooloff(),
        getNotificationSwitches(),
      ]);
      const map: Record<string, CronJob> = {};
      for (const j of list) map[j.fn] = j;
      setJobs(map);
      setRange(r);
      setCatchup(cu);
      setCooloff(co);
      setSwitches(sw);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const rows: Row[] = useMemo(
    () => META.map((m) => ({ ...m, schedule: jobs[m.fn]?.schedule ?? null, active: jobs[m.fn]?.active ?? false })),
    [jobs],
  );
  const weekly = rows.filter((r) => r.group === "weekly").sort((a, b) => a.order - b.order);
  const daily = rows.filter((r) => r.group === "daily").sort((a, b) => a.order - b.order);

  // Flip one event-driven notification. Optimistic-free: we write, then reload
  // from the row, so what is shown is always what will actually be sent.
  async function toggleSwitch(key: keyof NotificationSwitches) {
    const next = { ...switches, [key]: !switches[key] };
    setSwitchBusy(true);
    const err = await updateNotificationSwitches(next);
    setSwitchBusy(false);
    if (err) { toastError(err); return; }
    setSwitches(next);
    toastOk(next[key] ? "Notification turned on." : "Notification turned off.");
  }

  async function toggle(row: Row) {
    if (!row.schedule) { setEditing(row); return; }
    setToggling(row.fn);
    const err = await updateCronSchedule(row.fn, row.schedule, !row.active);
    setToggling(null);
    if (err) { toastError(err); return; }
    toastOk(`${row.label} ${row.active ? "paused" : "enabled"}.`);
    await load();
  }

  async function save(fn: string, schedule: string, active: boolean) {
    const err = await updateCronSchedule(fn, schedule, active);
    if (err) return err;
    toastOk("Schedule updated.");
    await load();
    return null;
  }

  async function saveRange(next: BookingSyncRange) {
    const err = await updateBookingSyncRange(next);
    if (err) return err;
    toastOk("Booking sync date range updated.");
    await load();
    return null;
  }

  async function saveCatchup(next: StaffingCatchup) {
    const err = await updateStaffingCatchup(next);
    if (err) return err;
    toastOk("Staffing catch-up timing updated.");
    await load();
    return null;
  }

  async function saveCooloff(next: CancellationCooloff) {
    const err = await updateCancellationCooloff(next);
    if (err) return err;
    toastOk("Cancellation cooling-off updated.");
    await load();
    return null;
  }

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Automation Schedule"
        subtitle="Control when each automated job runs. Times are shown in venue local time."
        right={<Button kind="secondary" onClick={load}><Icon name="activity" size={14} /> Refresh</Button>}
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 48px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, color: c.body, borderRadius: 10, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.5, marginBottom: 20 }}>
            <span style={{ color: c.green, flex: "none", marginTop: 1 }}><Icon name="info" size={16} /></span>
            <span>
              All times are shown and set in <b>{tzLabel()}</b> (Sydney/Melbourne venue local time, adjusts for daylight saving);
              the system stores them in UTC automatically. The weekly jobs run as a sequence each week — keep them in order
              (sync → confirm → offer → remind → escalate) so each step has the previous step's result to work with.
              Changes take effect from the next run.
            </span>
          </div>

          {loading ? <Spinner /> : (
            <>
              <Section title="Weekly booking & staffing cycle" hint="Runs once a week, in the order shown.">
                {weekly.map((r) => (
                  <div key={r.fn}>
                    {/* `step` is NOT the array index: the understaffed alert is a
                        numbered step in this sequence but has no cron row of its
                        own, so it is not in `weekly`. Numbering off the index
                        would skip it and mis-number everything after it. */}
                    <JobRow row={r} step={stepNo(r.fn)} busy={toggling === r.fn}
                      onEdit={() => setEditing(r)} onToggle={() => toggle(r)} />
                    {/* The sync's date range sits with the job it belongs to,
                        rather than in a separate settings screen. */}
                    {r.fn === "sync-bookings" && (
                      <RangeRow range={range} schedule={r.schedule} onEdit={() => setEditRange(true)} />
                    )}
                    {/* A shift confirmed AFTER this weekly slot is not sent by this
                        job — it is picked up by the daily Staffing Catch-Up (in the
                        Daily jobs section below). Spelled out here because that is
                        exactly where an admin looks when offers for a late-confirmed
                        shift went out a day later, at the catch-up's time, not 3pm. */}
                    {r.fn === "offer-tier-1" && (
                      <CatchupNote schedule={jobs["staffing-catchup"]?.schedule ?? null} tier1Schedule={r.schedule} />
                    )}
                    {/* The understaffed alert has no cron job of its own — it is
                        raised inside the Tier 3 Escalation run, but only once the
                        Tier 3 offer is a day old. It sits here, after the Tier 3
                        reminder, because that is the order it happens in and
                        where an admin looks to ask "when do I get told?". */}
                    {r.fn === "remind-tier-3" && (
                      <UnderstaffedAlertNote schedule={jobs["escalate-tier-3"]?.schedule ?? null}
                        step={stepNo("understaffed-alert")} />
                    )}
                  </div>
                ))}
              </Section>

              <Section title="Daily jobs" hint="Run every day at a fixed time.">
                {daily.map((r) => (
                  <div key={r.fn}>
                    <JobRow row={r} busy={toggling === r.fn}
                      onEdit={() => setEditing(r)} onToggle={() => toggle(r)} />
                    {/* The catch-up's wait sits with the job it governs. */}
                    {r.fn === "staffing-catchup" && (
                      <CatchupRow catchup={catchup} onEdit={() => setEditCatchup(true)} />
                    )}
                  </div>
                ))}
              </Section>

              {/* Not a cron job — it applies the moment a cleaner cancels. It
                  lives here because this is the page where an admin tunes how
                  the automation behaves, and it is the only other knob that
                  changes who gets offered a shift. */}
              <Section title="Cancellations" hint="Applies as soon as a cleaner cancels — not on a schedule.">
                <CooloffRow cooloff={cooloff} onEdit={() => setEditCooloff(true)} />
                {/* Event-driven notification: fires on the cleaner's reply, so it
                    has no cron row and no time to set — just on or off. */}
                <SwitchRow
                  label="Alert the Cleaning Manager"
                  desc="Sends the Cleaning Manager a WhatsApp the moment a cleaner cancels, naming the shift and how many are still confirmed. Wording is on the Message Templates page."
                  on={switches.lead_cleaner_cancelled}
                  busy={switchBusy}
                  onToggle={() => toggleSwitch("lead_cleaner_cancelled")}
                />
              </Section>
            </>
          )}
        </div>
      </div>

      {editing && (
        <EditModal row={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
      {editRange && (
        <RangeModal range={range} onClose={() => setEditRange(false)} onSave={saveRange} />
      )}
      {editCatchup && (
        <CatchupModal catchup={catchup} onClose={() => setEditCatchup(false)} onSave={saveCatchup} />
      )}
      {editCooloff && (
        <CooloffModal cooloff={cooloff} onClose={() => setEditCooloff(false)} onSave={saveCooloff} />
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 15, fontWeight: font.displayWeight, color: c.ink }}>{title}</h2>
        <span style={{ fontSize: 11.5, color: c.faint }}>{hint}</span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function JobRow({ row, step, busy, onEdit, onToggle }: {
  row: Row; step?: number; busy: boolean; onEdit: () => void; onToggle: () => void;
}) {
  const form = row.schedule ? parseCron(row.schedule) : null;
  const human = form ? describe(form) : row.schedule ? "Custom schedule" : "Not scheduled";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: `1px solid ${c.rowBd}` }}>
      {step != null && (
        <span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: row.active ? c.railGreenBg : "#f0eee9", color: row.active ? c.green : c.faint, border: `1px solid ${row.active ? c.railGreenBd : c.border}`, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{step}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{row.label}</span>
          {!row.active && <span style={{ background: "#f0eee9", color: "#6b665c", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>Paused</span>}
        </div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.45 }}>{row.desc}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5, color: row.active ? c.green : c.faint, fontWeight: 600 }}>
          <Icon name="clock" size={13} /> {human}
        </div>
      </div>
      <Toggle on={row.active} busy={busy} onClick={onToggle} />
      <Button kind="secondary" onClick={onEdit} style={{ padding: "7px 12px" }}>Edit</Button>
    </div>
  );
}

// The window the sync covers, anchored to the run day: it starts `lead_weeks`
// after the run and lasts `window_days`. Mirrors the arithmetic in
// sync-bookings/index.ts, so the preview is what the next run will actually do.
function windowFor(range: BookingSyncRange, runAt: Date): { from: Date; to: Date } {
  const DAY = 86400000;
  const lead = range.lead_weeks * 7;
  return {
    from: new Date(runAt.getTime() + lead * DAY),
    to: new Date(runAt.getTime() + (lead + range.window_days - 1) * DAY),
  };
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function RangeRow({ range, schedule, onEdit }: {
  range: BookingSyncRange; schedule: string | null; onEdit: () => void;
}) {
  const next = schedule ? nextCronRun(schedule) : null;
  const win = next ? windowFor(range, next) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px 14px 52px", borderTop: `1px dashed ${c.rowBd}`, background: "#fcfbf8" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Date range</div>
        <div style={{ fontSize: 12.5, color: c.body, marginTop: 4, lineHeight: 1.5 }}>
          Looks <b>{range.lead_weeks} week{range.lead_weeks === 1 ? "" : "s"}</b> ahead and covers{" "}
          <b>{range.window_days} day{range.window_days === 1 ? "" : "s"}</b>.
        </div>
        <div style={{ fontSize: 12, color: c.faint, marginTop: 3 }}>
          {win
            ? <>Next run syncs {fmtDay(win.from)} → {fmtDay(win.to)}</>
            : "Schedule this job to see the window it will cover."}
        </div>
      </div>
      <Button kind="secondary" onClick={onEdit} style={{ padding: "7px 12px" }}>Edit range</Button>
    </div>
  );
}

function RangeModal({ range, onClose, onSave }: {
  range: BookingSyncRange; onClose: () => void; onSave: (r: BookingSyncRange) => Promise<string | null>;
}) {
  const [lead, setLead] = useState(String(range.lead_weeks));
  const [days, setDays] = useState(String(range.window_days));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const L = BOOKING_SYNC_RANGE_LIMITS;
  const leadN = Number(lead);
  const daysN = Number(days);
  const leadOk = Number.isInteger(leadN) && leadN >= L.lead_weeks.min && leadN <= L.lead_weeks.max;
  const daysOk = Number.isInteger(daysN) && daysN >= L.window_days.min && daysN <= L.window_days.max;
  const win = leadOk && daysOk
    ? windowFor({ lead_weeks: leadN, window_days: daysN }, new Date())
    : null;

  async function submit() {
    if (!leadOk) { setErr(`Look ahead must be a whole number between ${L.lead_weeks.min} and ${L.lead_weeks.max} weeks.`); return; }
    if (!daysOk) { setErr(`Cover must be a whole number between ${L.window_days.min} and ${L.window_days.max} days.`); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ lead_weeks: leadN, window_days: daysN });
    setSaving(false);
    if (e) { setErr(e); return; }
    onClose();
  }

  const field: React.CSSProperties = {
    width: 90, boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
    border: `1px solid ${c.border3}`, borderRadius: 7, outline: "none", color: c.ink, background: "#fff",
  };

  return (
    <Modal title="Booking sync date range" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55, marginBottom: 16 }}>
        The window is anchored to the day the job runs, so it rolls forward automatically each week —
        you only need to change these when the lead time itself changes.
      </div>

      <div style={{ display: "flex", gap: 18, marginBottom: 16 }}>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.body, marginBottom: 6 }}>Look ahead</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={L.lead_weeks.min} max={L.lead_weeks.max} value={lead}
              onChange={(e) => setLead(e.target.value)} style={field} />
            <span style={{ fontSize: 12.5, color: c.muted }}>weeks</span>
          </div>
        </label>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.body, marginBottom: 6 }}>Cover</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={L.window_days.min} max={L.window_days.max} value={days}
              onChange={(e) => setDays(e.target.value)} style={field} />
            <span style={{ fontSize: 12.5, color: c.muted }}>days</span>
          </div>
        </label>
      </div>

      <div style={{ background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: c.body, lineHeight: 1.5 }}>
        {win
          ? <>A run today would sync <b>{fmtDay(win.from)}</b> → <b>{fmtDay(win.to)}</b>.</>
          : "Enter whole numbers to preview the window."}
      </div>

      {err && <div style={{ color: c.danger, fontSize: 12.5, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={saving}>Save range</Button>
      </div>
    </Modal>
  );
}

// Sits under "Tier 1 Offers". A shift confirmed after this weekly slot is not
// sent by it — the daily Staffing Catch-Up picks it up and offers Tier 1 at ITS
// run time (one hour after the weekly slot), which is why a late-confirmed
// shift's offers go out a day later, at 4pm rather than 3pm. The time is read
// from the catch-up's own schedule so it stays right if that job is rescheduled.
function CatchupNote({ schedule, tier1Schedule }: { schedule: string | null; tier1Schedule: string | null }) {
  const form = schedule ? parseCron(schedule) : null;
  // "Every day at 4:00 PM AEST" -> "4:00 PM AEST" so it reads naturally after "at".
  const when = form ? describe(form).replace(/^Every day at /, "") : "its next daily run";
  // Read the Tier 1 slot from the live cron rather than naming a time in prose —
  // this used to say "this 3pm slot", which no longer matched the schedule and
  // would go stale again the moment an admin edits the job.
  const t1form = tier1Schedule ? parseCron(tier1Schedule) : null;
  // describe() is "Every day at X" or "Every <day list> at X" — strip whatever
  // precedes the final " at " so a multi-weekday list reduces cleanly too.
  const t1when = t1form ? describe(t1form).replace(/^Every .* at /, "") : null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 12px 52px", borderTop: `1px dashed ${c.rowBd}`, background: "#fcfbf8" }}>
      <span style={{ color: c.green, flex: "none", marginTop: 1 }}><Icon name="info" size={14} /></span>
      <div style={{ fontSize: 12, color: c.body, lineHeight: 1.5 }}>
        Confirmed a shift <b>after</b> this run? It does not wait for next week —
        the daily <b>Staffing Catch-Up</b> job (see “Daily jobs” below) sends its first Tier 1
        offer at <b>{when}</b>. From there its reminders and escalations run at the same
        scheduled times as every other shift (the Tier 1/2/3 reminder and escalation jobs above),
        so a late-confirmed shift is chased on the same clock as the rest — only its first offer
        goes out at the catch-up's time rather than {t1when ? <>this <b>{t1when}</b> slot</> : "this weekly slot"}.
      </div>
    </div>
  );
}

// Step 9 of the sequence, and deliberately NOT a JobRow: the understaffed alert
// has no schedule of its own to edit or pause. It is raised by the Tier 3
// Escalation job (step 7), which re-checks every day and only alerts once the
// shift's Tier 3 offer is at least a day old — so the Tier 3 cleaners get the
// first message AND the next-morning reminder before Ashleigh is pulled in.
function UnderstaffedAlertNote({ schedule, step }: { schedule: string | null; step?: number }) {
  const form = schedule ? parseCron(schedule) : null;
  const when = form ? describe(form).replace(/^Every .* at /, "") : "its next daily run";
  return (
    // Laid out like a JobRow (same padding, same numbered circle) so it reads as
    // step N of the sequence — but with no Toggle/Edit, because there is no
    // schedule of its own to change. The amber circle marks that difference.
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", borderTop: `1px solid ${c.rowBd}`, background: "#fcfbf8" }}>
      {step != null && (
        <span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: "#FBF1DF", color: c.warn, border: `1px solid #EBD9B4`, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{step}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>Understaffed Alert</span>
          <span style={{ background: "#FBF1DF", color: "#8a6410", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>No separate schedule</span>
        </div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.45 }}>
          Once a shift has sat at Tier 3 for a full day and still has open spots, this raises
          the dashboard alert and emails Ashleigh. It is checked as part of <b>Tier 3 Escalation</b> (step {stepNo("escalate-tier-3")}),
          so it follows that job's time — the alert lands a <b>full day after</b> the Tier 3 offer, which
          means the Tier 3 cleaners have had both the first offer <b>and</b> the following-day reminder,
          with time to respond, before anyone is pulled in. One alert per shift: not repeated while it
          stays open, and never sent if the shift fills.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5, color: c.warn, fontWeight: 600 }}>
          <Icon name="clock" size={13} /> {when}, 24h after the Tier 3 offer
        </div>
      </div>
    </div>
  );
}

function CatchupRow({ catchup, onEdit }: { catchup: StaffingCatchup; onEdit: () => void }) {
  const d = catchup.escalation_wait_days;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px 14px 52px", borderTop: `1px dashed ${c.rowBd}`, background: "#fcfbf8" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.05em" }}>First-offer wait</div>
        <div style={{ fontSize: 12.5, color: c.body, marginTop: 4, lineHeight: 1.5 }}>
          A late-confirmed shift waits <b>{d === 1 ? "one day" : `${d} days`}</b> after confirmation
          before this job sends its first Tier 1 offer — long enough that the weekly slot claims it
          first if that slot is still coming.
        </div>
        <div style={{ fontSize: 12, color: c.faint, marginTop: 3 }}>
          After that first offer, reminders and escalations follow at the scheduled per-tier times
          above, the same as every other shift.
        </div>
      </div>
      <Button kind="secondary" onClick={onEdit} style={{ padding: "7px 12px" }}>Edit timing</Button>
    </div>
  );
}

// An on/off row for behaviour that has no schedule — same shape as a JobRow so
// the page reads consistently, but with a Toggle and no time or Edit button,
// because there is nothing to time.
function SwitchRow({ label, desc, on, busy, onToggle }: {
  label: string; desc: string; on: boolean; busy: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: `1px solid ${c.rowBd}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{label}</span>
          {!on && <span style={{ background: "#f0eee9", color: "#6b665c", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>Off</span>}
        </div>
        <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5, color: on ? c.green : c.faint, fontWeight: 600 }}>
          <Icon name="activity" size={13} /> {on ? "Sends as it happens" : "Not sending"}
        </div>
      </div>
      <Toggle on={on} busy={busy} onClick={onToggle} />
    </div>
  );
}

function CooloffRow({ cooloff, onEdit }: { cooloff: CancellationCooloff; onEdit: () => void }) {
  const h = cooloff.cooloff_hours;
  const window = h === 0 ? null : h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", background: c.panel, border: `1px solid ${c.border3}`, borderRadius: 10, marginTop: 8 }}>
      <div style={{ flex: 1, fontSize: 12.5, color: c.body, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          {window ? `Cooling-off: ${window}` : "Cooling-off: off"}
        </div>
        {window ? (
          <>
            When a cleaner cancels a shift, that shift is not automatically offered back to her
            for <b>{window}</b>. Everyone else still available is offered it straight away.
            You can always assign her manually in the meantime.
          </>
        ) : (
          <>
            Cooling-off is switched off — a cleaner who cancels can be offered the same shift
            again immediately.
          </>
        )}
      </div>
      <Button kind="secondary" onClick={onEdit} style={{ padding: "7px 12px" }}>Edit</Button>
    </div>
  );
}

function CooloffModal({ cooloff, onClose, onSave }: {
  cooloff: CancellationCooloff; onClose: () => void; onSave: (c: CancellationCooloff) => Promise<string | null>;
}) {
  const [hours, setHours] = useState(String(cooloff.cooloff_hours));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const L = CANCELLATION_COOLOFF_LIMITS;
  const n = Number(hours);
  const ok = Number.isInteger(n) && n >= L.cooloff_hours.min && n <= L.cooloff_hours.max;

  async function submit() {
    if (!ok) { setErr(`Cooling-off must be a whole number between ${L.cooloff_hours.min} and ${L.cooloff_hours.max} hours.`); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ cooloff_hours: n });
    setSaving(false);
    if (e) { setErr(e); return; }
    onClose();
  }

  const field: React.CSSProperties = {
    width: 90, boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
    border: `1px solid ${c.border3}`, borderRadius: 7, outline: "none", color: c.ink, background: "#fff",
  };

  return (
    <Modal title="Cancellation cooling-off" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55, marginBottom: 16 }}>
        When a cleaner cancels a shift she had accepted, the spot is re-offered to everyone
        else available. This sets how long before that shift can be offered back to her.
      </div>

      <label style={{ display: "block", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.body, marginBottom: 6 }}>Cooling-off</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="number" min={L.cooloff_hours.min} max={L.cooloff_hours.max} value={hours}
            onChange={(e) => setHours(e.target.value)} style={field} />
          <span style={{ fontSize: 12.5, color: c.muted }}>hours</span>
        </div>
      </label>

      <div style={{ background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: c.body, lineHeight: 1.6 }}>
        {!ok ? "Enter a whole number of hours." : n === 0 ? (
          <>
            <b>Cooling-off is off.</b> A cleaner who cancels can be offered the same shift again
            straight away — the behaviour before this setting existed.
          </>
        ) : (
          <>
            A cleaner who cancels won't be offered that shift again for <b>{n} hours</b>
            {n % 24 === 0 ? <> ({n / 24} day{n === 24 ? "" : "s"})</> : null}.
            Being taken off a shift by an admin doesn't start a cooling-off — only her own
            cancellation does. You can still assign her manually at any time, and it only
            affects that one shift.
          </>
        )}
      </div>

      {err && <div style={{ marginTop: 12, fontSize: 12.5, color: c.danger }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !ok}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function CatchupModal({ catchup, onClose, onSave }: {
  catchup: StaffingCatchup; onClose: () => void; onSave: (c: StaffingCatchup) => Promise<string | null>;
}) {
  const [wait, setWait] = useState(String(catchup.escalation_wait_days));
  const [grace, setGrace] = useState(String(catchup.offer_grace_hours));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const L = STAFFING_CATCHUP_LIMITS;
  const waitN = Number(wait);
  const graceN = Number(grace);
  const waitOk = Number.isInteger(waitN) && waitN >= L.escalation_wait_days.min && waitN <= L.escalation_wait_days.max;
  const graceOk = Number.isInteger(graceN) && graceN >= L.offer_grace_hours.min && graceN <= L.offer_grace_hours.max;

  async function submit() {
    if (!waitOk) { setErr(`Tier wait must be a whole number between ${L.escalation_wait_days.min} and ${L.escalation_wait_days.max} days.`); return; }
    if (!graceOk) { setErr(`Offer delay must be a whole number between ${L.offer_grace_hours.min} and ${L.offer_grace_hours.max} hours.`); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ escalation_wait_days: waitN, offer_grace_hours: graceN });
    setSaving(false);
    if (e) { setErr(e); return; }
    onClose();
  }

  const field: React.CSSProperties = {
    width: 90, boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
    border: `1px solid ${c.border3}`, borderRadius: 7, outline: "none", color: c.ink, background: "#fff",
  };

  return (
    <Modal title="Staffing catch-up timing" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55, marginBottom: 16 }}>
        The catch-up runs daily and moves along any shift the weekly cycle has left behind —
        one confirmed too late for its Tier 1 slot, or one sitting at a tier with nobody responding.
      </div>

      <div style={{ display: "flex", gap: 18, marginBottom: 16 }}>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.body, marginBottom: 6 }}>Tier wait</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={L.escalation_wait_days.min} max={L.escalation_wait_days.max} value={wait}
              onChange={(e) => setWait(e.target.value)} style={field} />
            <span style={{ fontSize: 12.5, color: c.muted }}>days</span>
          </div>
        </label>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.body, marginBottom: 6 }}>Delay first offer</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={L.offer_grace_hours.min} max={L.offer_grace_hours.max} value={grace}
              onChange={(e) => setGrace(e.target.value)} style={field} />
            <span style={{ fontSize: 12.5, color: c.muted }}>hours</span>
          </div>
        </label>
      </div>

      <div style={{ background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: c.body, lineHeight: 1.6 }}>
        {waitOk ? (
          <>
            A shift confirmed late is offered to Tier 1 on the next daily run
            {graceOk && graceN > 0 ? <> (after a {graceN}h delay)</> : null}, then escalates to
            Tier 2 <b>{waitN === 1 ? "the next day" : `${waitN} days later`}</b> without enough
            acceptances, and Tier 3 {waitN === 1 ? "the day after that" : `a further ${waitN} days later`}.
            Only the day is compared, never the time — the run time is this job's schedule above.
          </>
        ) : "Enter whole numbers to preview the timing."}
      </div>

      <div style={{ fontSize: 11.5, color: c.faint, marginTop: 10, lineHeight: 1.5 }}>
        Leave "Delay first offer" at 0 to offer as soon as the catch-up next runs after confirmation.
      </div>

      {err && <div style={{ color: c.danger, fontSize: 12.5, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={saving}>Save timing</Button>
      </div>
    </Modal>
  );
}

function Toggle({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} title={on ? "Pause this job" : "Enable this job"}
      style={{ flex: "none", width: 40, height: 23, borderRadius: 20, border: "none", cursor: busy ? "wait" : "pointer", background: on ? c.greenMid : "#cfcabc", position: "relative", transition: "background .15s", opacity: busy ? 0.6 : 1 }}>
      <span style={{ position: "absolute", top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </button>
  );
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first display

function EditModal({ row, onClose, onSave }: {
  row: Row; onClose: () => void; onSave: (fn: string, schedule: string, active: boolean) => Promise<string | null>;
}) {
  const parsed = row.schedule ? parseCron(row.schedule) : null;
  const isDaily = row.group === "daily";
  // Fall back to a sensible default form when the job is unscheduled/custom.
  const initial: ScheduleForm = parsed ?? {
    freq: isDaily ? "daily" : "weekly",
    weekdays: isDaily ? [] : [2],
    hour: 9, minute: 0,
  };
  const [form, setForm] = useState<ScheduleForm>(initial);
  const [raw, setRaw] = useState(row.schedule ?? "");
  const [mode, setMode] = useState<"form" | "raw">(row.schedule && !parsed ? "raw" : "form");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (p: Partial<ScheduleForm>) => setForm((f) => ({ ...f, ...p }));
  const toggleDay = (d: number) =>
    set({ weekdays: form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort((a, b) => a - b) });

  const expr = mode === "raw" ? raw.trim() : toCron(form);
  const preview = mode === "raw" ? (parseCron(raw.trim()) ? describe(parseCron(raw.trim())!) : "Custom schedule") : describe(form);
  const invalid = mode === "form" && form.freq === "weekly" && form.weekdays.length === 0;

  async function submit() {
    if (invalid) { setErr("Pick at least one day of the week."); return; }
    if (!expr) { setErr("Enter a schedule."); return; }
    setSaving(true); setErr(null);
    const e = await onSave(row.fn, expr, row.active);
    setSaving(false);
    if (e) { setErr(e); return; }
    onClose();
  }

  return (
    <Modal title={`Edit — ${row.label}`} onClose={onClose} width={480}>
      <div style={{ fontSize: 12.5, color: c.muted, marginTop: -6, marginBottom: 16, lineHeight: 1.45 }}>{row.desc}</div>

      {mode === "form" ? (
        <>
          <Label>Frequency</Label>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["daily", "weekly"] as Freq[]).map((f) => (
              <Segment key={f} on={form.freq === f} onClick={() => set({ freq: f, weekdays: f === "weekly" && form.weekdays.length === 0 ? [2] : form.weekdays })}>
                {f === "daily" ? "Every day" : "Weekly"}
              </Segment>
            ))}
          </div>

          {form.freq === "weekly" && (
            <>
              <Label>Days</Label>
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {WEEKDAY_ORDER.map((d) => {
                  const on = form.weekdays.includes(d);
                  return (
                    <button key={d} onClick={() => toggleDay(d)}
                      style={{ width: 44, padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? c.green : c.border3}`, background: on ? c.green : "#fff", color: on ? "#fff" : c.body }}>
                      {WEEKDAY_SHORT[d]}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <Label>Time ({tzLabel()})</Label>
          <input type="time" value={toTimeInput(form.hour, form.minute)}
            onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); set({ hour: h || 0, minute: m || 0 }); }}
            style={{ width: 140, border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "9px 11px", fontSize: 14, fontFamily: font.body, color: c.ink, outline: "none" }} />
        </>
      ) : (
        <>
          <Label>Cron expression (UTC)</Label>
          <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0 9 * * 2"
            style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "monospace", color: c.ink, outline: "none" }} />
          <div style={{ fontSize: 11.5, color: c.faint, marginTop: 6 }}>Advanced: minute hour day-of-month month day-of-week, in UTC.</div>
        </>
      )}

      <div style={{ marginTop: 18, padding: "11px 13px", background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 8 }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: c.muted2, fontWeight: 700 }}>This job will run</div>
        <div style={{ fontSize: 13.5, color: c.green, fontWeight: 600, marginTop: 3 }}>{invalid ? "—" : preview}</div>
        <div style={{ fontSize: 11, color: c.faint, fontFamily: "monospace", marginTop: 4 }}>{expr || "—"} (UTC)</div>
      </div>

      <button onClick={() => setMode(mode === "form" ? "raw" : "form")}
        style={{ background: "none", border: "none", color: c.teal, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "10px 0 0", display: "flex", alignItems: "center", gap: 5 }}>
        <Icon name={mode === "form" ? "list" : "clock"} size={13} />
        {mode === "form" ? "Advanced (edit cron directly)" : "Back to simple editor"}
      </button>

      {err && <div style={{ color: c.danger, fontSize: 12.5, fontWeight: 600, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 }}>
        <Button kind="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving || invalid}>{saving ? "Saving…" : "Save schedule"}</Button>
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>{children}</div>;
}

function Segment({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${on ? c.green : c.border3}`, background: on ? c.green : "#fff", color: on ? "#fff" : c.body }}>{children}</button>
  );
}

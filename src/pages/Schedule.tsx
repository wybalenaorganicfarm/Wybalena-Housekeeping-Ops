import { useEffect, useMemo, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Button, Modal, Spinner } from "../components/ui";
import {
  BOOKING_SYNC_RANGE_DEFAULT, BOOKING_SYNC_RANGE_LIMITS, getBookingSyncRange, getCronSchedules,
  getStaffingCatchup, STAFFING_CATCHUP_DEFAULT, STAFFING_CATCHUP_LIMITS, updateBookingSyncRange,
  updateCronSchedule, updateStaffingCatchup, type BookingSyncRange, type CronJob, type StaffingCatchup,
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
  { fn: "offer-tier-1", label: "Tier 1 Offers", desc: "Sends the first round of shift offers to Tier 1 cleaners.", group: "weekly", order: 3 },
  { fn: "remind-tier-1", label: "Tier 1 Non-Responder Reminders", desc: "Re-pings Tier 1 cleaners who were offered a shift but haven't replied.", group: "weekly", order: 4 },
  { fn: "escalate-tier-2", label: "Tier 2 Escalation", desc: "Opens shifts still unfilled up to Tier 2 cleaners.", group: "weekly", order: 5 },
  { fn: "remind-tier-2", label: "Tier 2 Non-Responder Reminders", desc: "Re-pings Tier 2 cleaners who were offered a shift but haven't replied.", group: "weekly", order: 6 },
  { fn: "escalate-tier-3", label: "Tier 3 Escalation", desc: "Opens shifts still unfilled up to Tier 3 cleaners.", group: "weekly", order: 7 },
  { fn: "remind-tier-3", label: "Tier 3 Non-Responder Reminders", desc: "Re-pings Tier 3 cleaners who were offered a shift but haven't replied.", group: "weekly", order: 8 },
  // Sit after the tier sequence — both are independent of the offer/escalation flow.
  { fn: "wipeover-notify", label: "Wipeover Cleaning Alert", desc: "Emails Ashleigh when a >3-day gap between bookings needs a wipeover clean.", group: "weekly", order: 9 },
  { fn: "mid-retreat-notify", label: "Mid-Retreat Cleaning Alert", desc: "Emails and WhatsApps Ashleigh when a stay of 7+ nights needs a mid-retreat clean scheduled by hand.", group: "weekly", order: 10 },
  { fn: "staffing-catchup", label: "Staffing Catch-Up", desc: "Safety net: offers any shift confirmed too late for the weekly run, and escalates shifts whose tier wait has elapsed.", group: "daily", order: 6.5 },
  { fn: "pre-shift-reminder", label: "Pre-Shift Reminders", desc: "Reminds assigned cleaners about tomorrow's shift and sends the team lead one roster summary.", group: "daily", order: 7 },
  { fn: "cancellation-followup", label: "Cancellation Follow-up", desc: "Handles guest cancellations and frees the affected shifts.", group: "daily", order: 8 },
  { fn: "health-check", label: "Connection Health Check", desc: "Checks that calendar, WhatsApp and email integrations are reachable.", group: "daily", order: 9 },
];

type Row = JobMeta & { schedule: string | null; active: boolean };

export function Schedule() {
  const [jobs, setJobs] = useState<Record<string, CronJob>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [range, setRange] = useState<BookingSyncRange>(BOOKING_SYNC_RANGE_DEFAULT);
  const [editRange, setEditRange] = useState(false);
  const [catchup, setCatchup] = useState<StaffingCatchup>(STAFFING_CATCHUP_DEFAULT);
  const [editCatchup, setEditCatchup] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [list, r, cu] = await Promise.all([getCronSchedules(), getBookingSyncRange(), getStaffingCatchup()]);
      const map: Record<string, CronJob> = {};
      for (const j of list) map[j.fn] = j;
      setJobs(map);
      setRange(r);
      setCatchup(cu);
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
                {weekly.map((r, i) => (
                  <div key={r.fn}>
                    <JobRow row={r} step={i + 1} busy={toggling === r.fn}
                      onEdit={() => setEditing(r)} onToggle={() => toggle(r)} />
                    {/* The sync's date range sits with the job it belongs to,
                        rather than in a separate settings screen. */}
                    {r.fn === "sync-bookings" && (
                      <RangeRow range={range} schedule={r.schedule} onEdit={() => setEditRange(true)} />
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

function CatchupRow({ catchup, onEdit }: { catchup: StaffingCatchup; onEdit: () => void }) {
  const h = catchup.escalation_wait_hours;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px 14px 52px", borderTop: `1px dashed ${c.rowBd}`, background: "#fcfbf8" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tier wait</div>
        <div style={{ fontSize: 12.5, color: c.body, marginTop: 4, lineHeight: 1.5 }}>
          A shift escalates to the next tier <b>{h} hour{h === 1 ? "" : "s"}</b> after its last offer, if still short.
        </div>
        <div style={{ fontSize: 12, color: c.faint, marginTop: 3 }}>
          Measured per shift, so one confirmed late still moves through the tiers on the same rhythm.
        </div>
      </div>
      <Button kind="secondary" onClick={onEdit} style={{ padding: "7px 12px" }}>Edit timing</Button>
    </div>
  );
}

function CatchupModal({ catchup, onClose, onSave }: {
  catchup: StaffingCatchup; onClose: () => void; onSave: (c: StaffingCatchup) => Promise<string | null>;
}) {
  const [wait, setWait] = useState(String(catchup.escalation_wait_hours));
  const [grace, setGrace] = useState(String(catchup.offer_grace_hours));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const L = STAFFING_CATCHUP_LIMITS;
  const waitN = Number(wait);
  const graceN = Number(grace);
  const waitOk = Number.isInteger(waitN) && waitN >= L.escalation_wait_hours.min && waitN <= L.escalation_wait_hours.max;
  const graceOk = Number.isInteger(graceN) && graceN >= L.offer_grace_hours.min && graceN <= L.offer_grace_hours.max;

  async function submit() {
    if (!waitOk) { setErr(`Tier wait must be a whole number between ${L.escalation_wait_hours.min} and ${L.escalation_wait_hours.max} hours.`); return; }
    if (!graceOk) { setErr(`Offer delay must be a whole number between ${L.offer_grace_hours.min} and ${L.offer_grace_hours.max} hours.`); return; }
    setSaving(true); setErr(null);
    const e = await onSave({ escalation_wait_hours: waitN, offer_grace_hours: graceN });
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
            <input type="number" min={L.escalation_wait_hours.min} max={L.escalation_wait_hours.max} value={wait}
              onChange={(e) => setWait(e.target.value)} style={field} />
            <span style={{ fontSize: 12.5, color: c.muted }}>hours</span>
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
            Tier 2 after <b>{waitN}h</b> without enough acceptances, and Tier 3 <b>{waitN}h</b> after that.
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

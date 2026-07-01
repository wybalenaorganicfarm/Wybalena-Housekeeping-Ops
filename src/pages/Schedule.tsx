import { useEffect, useMemo, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { Button, Modal, Spinner } from "../components/ui";
import { getCronSchedules, updateCronSchedule, type CronJob } from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import {
  describe, parseCron, toCron, toTimeInput, WEEKDAY_SHORT, TZ_LABEL,
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
  { fn: "remind-nonresponders", label: "Non-Responder Reminders", desc: "Re-pings cleaners who were offered a shift but haven't replied.", group: "weekly", order: 4 },
  { fn: "escalate-tier-2", label: "Tier 2 Escalation", desc: "Opens shifts still unfilled up to Tier 2 cleaners.", group: "weekly", order: 5 },
  { fn: "escalate-tier-3", label: "Tier 3 Escalation", desc: "Opens shifts still unfilled up to Tier 3 cleaners.", group: "weekly", order: 6 },
  { fn: "wipeover-notify", label: "Wipeover Cleaning Alert", desc: "Emails Ashley when a >3-day gap between bookings needs a wipeover clean.", group: "weekly", order: 6.5 },
  { fn: "pre-shift-reminder", label: "Pre-Shift Reminders", desc: "Reminds assigned cleaners about their upcoming shift.", group: "daily", order: 7 },
  { fn: "cancellation-followup", label: "Cancellation Follow-up", desc: "Handles guest cancellations and frees the affected shifts.", group: "daily", order: 8 },
  { fn: "health-check", label: "Connection Health Check", desc: "Checks that calendar, WhatsApp and email integrations are reachable.", group: "daily", order: 9 },
];

type Row = JobMeta & { schedule: string | null; active: boolean };

export function Schedule() {
  const [jobs, setJobs] = useState<Record<string, CronJob>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const list = await getCronSchedules();
      const map: Record<string, CronJob> = {};
      for (const j of list) map[j.fn] = j;
      setJobs(map);
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
              All times are shown and set in <b>{TZ_LABEL}</b> (venue local time); the system stores them in UTC automatically.
              The weekly jobs run as a sequence each week — keep them in order (sync → confirm → offer → remind → escalate)
              so each step has the previous step's result to work with. Changes take effect from the next run.
            </span>
          </div>

          {loading ? <Spinner /> : (
            <>
              <Section title="Weekly booking & staffing cycle" hint="Runs once a week, in the order shown.">
                {weekly.map((r, i) => (
                  <JobRow key={r.fn} row={r} step={i + 1} busy={toggling === r.fn}
                    onEdit={() => setEditing(r)} onToggle={() => toggle(r)} />
                ))}
              </Section>

              <Section title="Daily jobs" hint="Run every day at a fixed time.">
                {daily.map((r) => (
                  <JobRow key={r.fn} row={r} busy={toggling === r.fn}
                    onEdit={() => setEditing(r)} onToggle={() => toggle(r)} />
                ))}
              </Section>
            </>
          )}
        </div>
      </div>

      {editing && (
        <EditModal row={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 15, fontWeight: 700, color: c.ink }}>{title}</h2>
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

          <Label>Time ({TZ_LABEL})</Label>
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

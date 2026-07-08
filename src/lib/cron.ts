// Cron <-> friendly-schedule conversion for the Automation Schedule page.
//
// pg_cron fires in UTC only. The venue runs on Australia/Sydney (NSW/VIC),
// which observes daylight saving — AEST (UTC+10) in winter, AEDT (UTC+11) in
// summer. There is no single fixed offset, so every conversion below resolves
// the offset for the specific instant it concerns (DST-aware). The UI always
// speaks LOCAL venue time; every cron expression stored in the DB is UTC.
//
// ⚠ pg_cron LIMITATION: a stored expression is a fixed UTC time — it can't
//   track DST on its own. A job set in one season fires 1h off after the next
//   DST switch until it is re-saved. Display always shows the true next-run
//   local time, so the drift is visible; re-open + Save to re-anchor.
export const TZ = "Australia/Sydney";

// Offset in minutes (local = UTC + offset) for a given UTC instant, DST-aware.
function offsetMinAt(utc: Date): number {
  const tzn = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(utc).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = tzn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

// Sydney-local calendar/clock parts for a UTC instant.
function local(utc: Date) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(utc);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +g("year"), mo: +g("month") - 1, d: +g("day"), h: +g("hour") % 24, mi: +g("minute"), dow: dow[g("weekday")] };
}

// Sydney wall-clock (Y, 0-based mo, D, h, mi) -> the UTC instant it maps to.
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi);
  let off = offsetMinAt(new Date(guess));
  const off2 = offsetMinAt(new Date(guess - off * 60000)); // refine across a transition
  if (off2 !== off) off = off2;
  return new Date(guess - off * 60000);
}

// Offset (minutes) at the NEXT occurrence of a form's local time — the offset
// we anchor a freshly-saved cron to.
function offsetForNext(form: ScheduleForm, now: Date): number {
  const b = local(now);
  for (let i = 0; i <= 14; i++) {
    const cal = local(new Date(Date.UTC(b.y, b.mo, b.d + i)));
    const utc = wallToUtc(cal.y, cal.mo, cal.d, form.hour, form.minute);
    if (utc <= now) continue;
    if (form.freq === "weekly" && form.weekdays.length && !form.weekdays.includes(local(utc).dow)) continue;
    return offsetMinAt(utc);
  }
  return offsetMinAt(now);
}

// Current venue-time abbreviation (AEDT in summer, AEST in winter).
export function tzLabel(at: Date = new Date()): string {
  return offsetMinAt(at) === 660 ? "AEDT" : "AEST";
}

export type Freq = "daily" | "weekly";

// All fields are LOCAL venue time. weekdays: 0=Sun … 6=Sat.
export interface ScheduleForm {
  freq: Freq;
  weekdays: number[];
  hour: number;   // 0–23
  minute: number; // 0–59
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const mod = (n: number, m: number) => ((n % m) + m) % m;

// Parse the small family of expressions this app produces: single minute + single
// hour, day-of-month "*", month "*", and day-of-week "*" or a comma list of ints.
// Anything more exotic (ranges, steps) returns null → the UI shows it read-only.
export function parseCron(expr: string): ScheduleForm | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;

  const minute = Number(m), hour = Number(h);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (dom !== "*" || mon !== "*") return null;

  // UTC minute-of-day for the fire time, shifted into local time using the
  // offset at the next actual run (DST-aware).
  const utcMinOfDay = hour * 60 + minute;
  const off = offsetMinAt(nextCronRun(expr) ?? new Date());
  const localMinOfDay = mod(utcMinOfDay + off, 1440);
  const dayDelta = Math.floor((utcMinOfDay + off) / 1440); // 0 or +1
  const lHour = Math.floor(localMinOfDay / 60);
  const lMin = localMinOfDay % 60;

  if (dow === "*") {
    return { freq: "daily", weekdays: [], hour: lHour, minute: lMin };
  }

  const utcDays = dow.split(",").map((d) => Number(d.trim()));
  if (utcDays.some((d) => !Number.isInteger(d) || d < 0 || d > 7)) return null;
  const weekdays = [...new Set(utcDays.map((d) => mod((d === 7 ? 0 : d) + dayDelta, 7)))].sort((a, b) => a - b);
  return { freq: "weekly", weekdays, hour: lHour, minute: lMin };
}

// Serialize a local-time form back to a UTC cron expression.
export function toCron(form: ScheduleForm): string {
  const off = offsetForNext(form, new Date());
  const localMinOfDay = form.hour * 60 + form.minute;
  const utcMinOfDay = mod(localMinOfDay - off, 1440);
  const dayDelta = Math.floor((localMinOfDay - off) / 1440); // 0 or -1
  const uHour = Math.floor(utcMinOfDay / 60);
  const uMin = utcMinOfDay % 60;

  if (form.freq === "daily" || form.weekdays.length === 0) {
    return `${uMin} ${uHour} * * *`;
  }
  const utcDays = [...new Set(form.weekdays.map((d) => mod(d + dayDelta, 7)))].sort((a, b) => a - b);
  return `${uMin} ${uHour} * * ${utcDays.join(",")}`;
}

// "1:30 PM", from local hour/minute.
export function fmtTime(hour: number, minute: number): string {
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

// Plain-English one-liner, e.g. "Every Tuesday at 1:30 PM AEDT".
export function describe(form: ScheduleForm): string {
  const t = `${fmtTime(form.hour, form.minute)} ${tzLabel()}`;
  if (form.freq === "daily" || form.weekdays.length === 0) return `Every day at ${t}`;
  if (form.weekdays.length === 7) return `Every day at ${t}`;
  const days = form.weekdays.map((d) => WEEKDAY_LONG[d]);
  const list = days.length === 1 ? days[0]
    : days.slice(0, -1).join(", ") + " & " + days[days.length - 1];
  return `Every ${list} at ${t}`;
}

// "HH:MM" for <input type="time"> (24h, zero-padded).
export const toTimeInput = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

// Next fire time (as a Date) for the cron forms this app produces: single
// minute + hour, day-of-month "*", month "*", day-of-week "*" or a comma list of
// UTC weekday ints. The stored expression is UTC. Returns null for exotic
// expressions or when nothing matches within ~2 weeks.
export function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  const minute = Number(m), hour = Number(h);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (dom !== "*" || mon !== "*") return null;

  let days: number[] | null = null;
  if (dow !== "*") {
    days = dow.split(",").map((d) => Number(d.trim()) % 7);
    if (days.some((d) => !Number.isInteger(d))) return null;
  }
  for (let i = 0; i <= 14; i++) {
    const cand = new Date(Date.UTC(
      from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i, hour, minute, 0, 0,
    ));
    if (cand <= from) continue;
    if (days && !days.includes(cand.getUTCDay())) continue;
    return cand;
  }
  return null;
}

// Short human label for a future time: "in <1h", "in ~5h", else venue-local
// "Wed 1:45 PM".
export function fmtRelative(target: Date, now: Date = new Date()): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "due now";
  const hours = ms / 3600000;
  if (hours < 1) return "in <1h";
  if (hours < 48) return `in ~${Math.round(hours)}h`;
  return target.toLocaleString("en-AU", {
    timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit",
  });
}

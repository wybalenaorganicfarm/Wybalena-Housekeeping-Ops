// Cron <-> friendly-schedule conversion for the Automation Schedule page.
//
// pg_cron fires in UTC only. The venue runs on a single fixed-offset timezone
// (TESTING: Asia/Calcutta / IST, UTC+5:30, no DST — mirrors 20260625100100_cron.sql).
// The UI always speaks LOCAL venue time; every cron expression stored in the DB is
// UTC. All conversion happens here so the rest of the app never touches offsets.
//
// ⚠ GO-LIVE (Australia): set TZ_OFFSET_MIN / TZ_LABEL to the confirmed venue tz.
//   A DST timezone (Melbourne/Sydney) can't be a single fixed offset — revisit
//   this file and the cron migration together before production.
export const TZ_OFFSET_MIN = 330; // IST = +5h30m
export const TZ_LABEL = "IST";

const WEEK = 7 * 1440;

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

  // UTC minute-of-week for the fire time, shifted into local time.
  const utcMinOfDay = hour * 60 + minute;
  const localMinOfDay = mod(utcMinOfDay + TZ_OFFSET_MIN, 1440);
  const dayDelta = Math.floor((utcMinOfDay + TZ_OFFSET_MIN) / 1440); // 0 or +1
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
  const localMinOfDay = form.hour * 60 + form.minute;
  const utcMinOfDay = mod(localMinOfDay - TZ_OFFSET_MIN, 1440);
  const dayDelta = Math.floor((localMinOfDay - TZ_OFFSET_MIN) / 1440); // 0 or -1
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

// Plain-English one-liner, e.g. "Every Tuesday at 1:30 PM (IST)".
export function describe(form: ScheduleForm): string {
  const t = `${fmtTime(form.hour, form.minute)} ${TZ_LABEL}`;
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

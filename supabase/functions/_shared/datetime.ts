// Human date/time formatting for messages cleaners actually read.
//
// Shift dates are plain YYYY-MM-DD strings and start times plain HH:MM(:SS) —
// they carry no timezone, so we format them by hand rather than via Date
// locale/timezone conversion, which would shift a date across midnight
// depending on where the Edge Function happens to run.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// 1st / 2nd / 3rd / 4th … 11th–13th are the exceptions.
function ordinal(d: number): string {
  if (d % 100 >= 11 && d % 100 <= 13) return `${d}th`;
  return `${d}${["th", "st", "nd", "rd"][d % 10] ?? "th"}`;
}

// "2026-08-23" -> "Sunday 23rd August 2026". Returns the input unchanged if it
// isn't a plain date, so a message can never render as "Invalid Date".
export function prettyDate(dateStr: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ""));
  if (!m) return String(dateStr ?? "");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const weekday = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday} ${ordinal(d)} ${MONTHS[mo - 1]} ${y}`;
}

// "10:00" / "10:00:00" -> "10:00am"; "12:00" -> "12:00pm"; "00:30" -> "12:30am".
export function prettyTime(timeStr: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr ?? ""));
  if (!m) return String(timeStr ?? "");
  const h24 = Number(m[1]);
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]}${suffix}`;
}

// "Sunday 23rd August 2026 at 10:00am" — used where one phrase reads better.
export function prettyDateTime(dateStr: string, timeStr: string): string {
  return `${prettyDate(dateStr)} at ${prettyTime(timeStr)}`;
}

// The venue's calendar day (Australia/Sydney, DST-aware) as YYYY-MM-DD. Supabase
// runs UTC regardless of project region and Sydney is +10/+11, so the 06:00 UTC
// cron slot is already 4pm the SAME local day. Same idiom as sync-bookings.
export function venueDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// Whole calendar days from one YYYY-MM-DD to another. Both parsed at UTC midnight
// so a DST changeover — which makes a local day 23 or 25 hours long — can't nudge
// the count across a boundary.
export function daysBetweenDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

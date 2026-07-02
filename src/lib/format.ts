import { STATUS, SHIFT_TYPE_LABEL } from "../theme";
import type { Booking, Shift, ShiftStaffing } from "./types";

export function timeParts(t: string): { hour: string; min: string } {
  // "10:00:00" -> 10:00 am/pm split
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "pm" : "am";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return { hour: String(h), min: `${mStr ?? "00"} ${ampm}` };
}

export function dateLabel(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

// "Monday, 22 June" for the dashboard greeting line.
export function longDateLabel(d: Date): string {
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}

// "week of 27 Jul" for the confirm-batch panel.
export function weekOfLabel(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Monday (00:00) of the week containing the given date.
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

// ISO key (yyyy-mm-dd of Monday) used to group shifts by week.
export function weekKey(dateStr: string): string {
  const m = startOfWeek(new Date(dateStr + "T00:00:00"));
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}

// "THIS WEEK · 22–28 Jun" / "NEXT WEEK · 29 Jun – 5 Jul" / "27 Jul – 2 Aug".
export function weekRangeLabel(mondayKey: string, today: Date = new Date()): string {
  const mon = new Date(mondayKey + "T00:00:00");
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  const sameMonth = mon.getMonth() === sun.getMonth();
  const day = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric" });
  const dayMon = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  const range = sameMonth ? `${day(mon)}–${dayMon(sun)}` : `${dayMon(mon)} – ${dayMon(sun)}`;
  const diff = Math.round((startOfWeek(mon).getTime() - startOfWeek(today).getTime()) / (7 * 86400000));
  const prefix = diff === 0 ? "THIS WEEK" : diff === 1 ? "NEXT WEEK" : "";
  return prefix ? `${prefix} · ${range}` : range;
}

// Type column label: "Standard", "Deep", "Mid-Retreat".
const TYPE_COLUMN: Record<string, string> = {
  standard: "Standard",
  deep_full_venue: "Deep",
  mid_retreat: "Mid-Retreat",
  other: "Other",
};
export function typeColumn(s: Shift): string {
  return TYPE_COLUMN[s.shift_type] ?? s.shift_type;
}

// "Mar 2024" join label.
export function monthYear(d: string): string {
  return new Date(d).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

// "1:40 PM" time label.
export function timeLabel(d: string): string {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "Today, 1:40 PM" or "5 Jun".
export function lastActiveLabel(d: string): string {
  const dt = new Date(d);
  const now = new Date();
  return dt.toDateString() === now.toDateString()
    ? `Today, ${timeLabel(d)}`
    : dt.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// "27 Jul 2026, 5:00 PM" for booking check-in / check-out.
export function dateTimeLabel(d: string): string {
  return new Date(d).toLocaleString("en-AU", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Acceptance rate as a whole-number percent (null when no history).
export function acceptRate(accepted: number, declined: number, cancelled: number): number | null {
  const total = accepted + declined + cancelled;
  return total === 0 ? null : Math.round((accepted / total) * 100);
}

// Stable pseudo booking ref (e.g. "#4821") derived from a uuid.
export function bookingRef(id: string | null): string {
  if (!id) return "";
  const n = parseInt(id.replace(/[^0-9a-f]/gi, "").slice(0, 6) || "0", 16);
  return `#${(n % 9000) + 1000}`;
}

// Short type badge label: "Standard", "Deep", "Mid-Retreat", "Full Venue".
const SHORT_TYPE: Record<string, string> = {
  standard: "Standard",
  deep_full_venue: "Deep",
  mid_retreat: "Mid-Retreat",
  other: "Other",
};
export function shortType(s: Shift): string {
  return SHORT_TYPE[s.shift_type] ?? s.shift_type;
}

// Title line is now just the clean type, stated plainly: "Standard Clean".
export function shiftTitle(s: Shift): string {
  return SHIFT_TYPE_LABEL[s.shift_type] ?? s.shift_type;
}

// Guest/booking name for a shift; falls back to the clean-type label when there
// is no linked booking (e.g. manual shifts).
export function shiftBookingName(s: Shift, bookings: Record<string, Booking>): string {
  return (s.booking_id && bookings[s.booking_id]?.guest_name) || shiftTitle(s);
}

// Venue scope: "Full venue" or "Partial · The Barn, Studio".
export function venueLabel(s: Shift): string {
  return s.venue_scope === "partial_venue" && s.buildings?.length
    ? `Partial · ${s.buildings.join(", ")}`
    : "Full venue";
}

// Secondary line under the title — the venue scope.
export function shiftSubtitle(s: Shift, _st?: ShiftStaffing): string {
  return venueLabel(s);
}

export function statusOf(s: Shift) {
  return STATUS[s.status as keyof typeof STATUS] ?? STATUS.cancelled;
}

export function typeLabel(s: Shift): string {
  return SHIFT_TYPE_LABEL[s.shift_type] ?? s.shift_type;
}

// Build the colored staffing squares: team lead (indigo), accepted (green),
// offered (amber), open (grey).
export function staffingDots(st: ShiftStaffing | undefined, required: number): string[] {
  const lead = st?.lead_count ?? 0;
  const accepted = st?.accepted_count ?? 0;
  const offered = st?.offered_count ?? 0;
  // required_cleaners counts cleaners only; the lead is an extra slot on top.
  const open = Math.max(required - accepted - offered, 0);
  const dots: string[] = [];
  for (let i = 0; i < lead; i++) dots.push("#5E6AC4");
  for (let i = 0; i < accepted; i++) dots.push("#3D8B5F");
  for (let i = 0; i < offered; i++) dots.push("#C8821A");
  for (let i = 0; i < open; i++) dots.push("#e0dbd0");
  return dots.slice(0, required + lead);
}

// "1 + n / required confirmed" — the lead is always the reserved first slot.
export function countLabel(st: ShiftStaffing | undefined, required: number): string {
  const lead = st?.lead_count ?? 0;
  const accepted = st?.accepted_count ?? 0;
  const assigned = lead > 0 ? `${lead} + ${accepted}` : `${accepted}`;
  return `${assigned}/${required} confirmed`;
}

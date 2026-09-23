// Shared month-grid geometry + bar packing for the Bookings, Shifts and
// Dashboard calendars, so all three lay out identically (Google-Calendar style:
// a multi-day stay is ONE continuous bar across the days it covers, not a pill
// repeated on — or stuck to — the check-in day).

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Midnight of the day `d` falls on. A stay is a range of DAYS, not of instants —
// comparing raw timestamps would put a 10:00 check-out and a 14:00 check-in on
// the same calendar day into different buckets.
export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Whole days from a to b. Rounded because a DST changeover makes a "day" 23 or
// 25 hours long, which would otherwise drift the span by one column.
export function daysBetween(a: Date, b: Date): number {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86400000);
}

// Parse a date-only string ("2026-09-30") as LOCAL midnight. `new Date(s)` on a
// bare date parses as UTC, which shifts the day backwards for anyone east of
// Greenwich — Australia included — landing shifts on the wrong calendar cell.
export function localDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

// One item's bar within ONE week row. A run crossing a Sunday produces a
// segment per week, each drawn flat on the side where it continues.
export interface Segment<T> {
  item: T;
  col: number;         // 0-6, Monday-based
  span: number;        // columns covered in this week
  startsHere: boolean; // the real start falls in this week
  endsHere: boolean;   // the real end falls in this week
  lane: number;        // stacking row, so overlapping runs don't collide
}

export interface Span<T> { item: T; start: Date; end: Date; sort: string }

// Place every run overlapping this week into the fewest stacked lanes (greedy
// interval partitioning: first lane whose last bar has already ended).
// `laneOffset` reserves leading lanes for another pass (bookings above shifts).
export function layoutWeek<T>(spans: Span<T>[], weekStart: Date, laneOffset = 0): Segment<T>[] {
  const weekEnd = addDays(weekStart, 6);

  const visible = spans
    .filter(({ start, end }) => end >= weekStart && start <= weekEnd)
    // Earliest start first, longest first on a tie — keeps long runs on the
    // upper lanes so the block reads as one run rather than a staircase.
    .sort((x, y) =>
      (x.start.getTime() - y.start.getTime()) ||
      (y.end.getTime() - x.end.getTime()) ||
      x.sort.localeCompare(y.sort));

  const laneLastCol: number[] = [];
  return visible.map(({ item, start, end }) => {
    const segStart = start > weekStart ? start : weekStart;
    const segEnd = end < weekEnd ? end : weekEnd;
    const col = daysBetween(weekStart, segStart);
    const span = daysBetween(segStart, segEnd) + 1;

    let lane = laneLastCol.findIndex((last) => last < col);
    if (lane === -1) { lane = laneLastCol.length; laneLastCol.push(-1); }
    laneLastCol[lane] = col + span - 1;

    return {
      item, col, span,
      lane: lane + laneOffset,
      startsHere: start.getTime() === segStart.getTime(),
      endsHere: end.getTime() === segEnd.getTime(),
    };
  });
}

// How many lanes a set of segments occupies in a week (for stacking a second
// pass underneath the first).
export function laneCount<T>(segments: Segment<T>[]): number {
  return segments.reduce((n, s) => Math.max(n, s.lane + 1), 0);
}

// The month to open on: the month of `preferred` when given, otherwise the
// current month if it holds any data, otherwise the month of the nearest
// upcoming run (or the most recent past one). Stops the calendar opening on an
// empty month and looking broken when the data sits in another year.
export function initialMonth(preferred: string | undefined, dates: string[], today = new Date()): Date {
  if (preferred) {
    const d = localDate(preferred);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const months = dates.map((s) => s.slice(0, 7)).filter(Boolean).sort();
  if (months.length === 0 || months.includes(cur)) return new Date(today.getFullYear(), today.getMonth(), 1);
  const next = months.find((m) => m >= cur) ?? months[months.length - 1];
  const [y, m] = next.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

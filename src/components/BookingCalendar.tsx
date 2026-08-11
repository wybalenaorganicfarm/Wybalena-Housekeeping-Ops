import { useMemo, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "./Icon";
import type { Booking } from "../lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Midnight of the day `d` falls on. A stay is a range of DAYS, not of instants —
// comparing the raw timestamps would put a 10:00 check-out and a 14:00 check-in
// on the same day into different buckets.
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Whole days from a to b. Rounded because a DST changeover makes a "day" 23 or
// 25 hours long, which would otherwise drift the span by one column.
function daysBetween(a: Date, b: Date): number {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86400000);
}

// One booking's bar within ONE week row. A stay crossing a Sunday produces a
// segment per week, each drawn flat on the side where it continues.
interface Segment {
  b: Booking;
  col: number;        // 0-6, Monday-based
  span: number;       // columns covered in this week
  startsHere: boolean; // the real check-in falls in this week
  endsHere: boolean;   // the real check-out falls in this week
  lane: number;        // stacking row, so overlapping stays don't collide
}

// Place every stay overlapping this week into the fewest stacked lanes
// (greedy interval partitioning: first lane whose last bar has already ended).
function layoutWeek(bookings: Booking[], weekStart: Date): Segment[] {
  const weekEnd = addDays(weekStart, 6);

  const spans = bookings
    .map((b) => {
      const s = dayStart(new Date(b.check_in));
      const e = dayStart(new Date(b.check_out));
      // Check-out day is included: the guest is still on site that morning, and
      // it is the day the cleaning shift is created for.
      return { b, s, e: e < s ? s : e };
    })
    .filter(({ s, e }) => e >= weekStart && s <= weekEnd)
    // Earliest start first, longest first on a tie — keeps long stays on the
    // upper lanes so the block reads as one run rather than a staircase.
    .sort((x, y) =>
      (x.s.getTime() - y.s.getTime()) ||
      (y.e.getTime() - x.e.getTime()) ||
      x.b.check_in.localeCompare(y.b.check_in));

  const laneLastCol: number[] = [];
  return spans.map(({ b, s, e }) => {
    const segStart = s > weekStart ? s : weekStart;
    const segEnd = e < weekEnd ? e : weekEnd;
    const col = daysBetween(weekStart, segStart);
    const span = daysBetween(segStart, segEnd) + 1;

    let lane = laneLastCol.findIndex((last) => last < col);
    if (lane === -1) { lane = laneLastCol.length; laneLastCol.push(-1); }
    laneLastCol[lane] = col + span - 1;

    return {
      b, col, span, lane,
      startsHere: s.getTime() === segStart.getTime(),
      endsHere: e.getTime() === segEnd.getTime(),
    };
  });
}

const navBtn = { width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.body, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;

export function BookingCalendar({ bookings, initialDate, onSelect }: {
  bookings: Booking[]; initialDate?: string; onSelect: (b: Booking) => void;
}) {
  const today = new Date();
  const init = initialDate ? new Date(initialDate) : today;
  const [cursor, setCursor] = useState(new Date(init.getFullYear(), init.getMonth(), 1));

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // back to Monday

  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => {
      const weekStart = addDays(gridStart, w * 7);
      return {
        weekStart,
        days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        segments: layoutWeek(bookings, weekStart),
      };
    }),
    [bookings, gridStart.getTime()],
  );

  const todayStr = ymd(today);
  const monthLabel = cursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const move = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${c.border}` }}>
        <h3 style={{ fontFamily: font.display, fontSize: 17, fontWeight: font.displayWeight, margin: 0 }}>{monthLabel}</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => move(-1)} style={navBtn}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevronRight" size={15} strokeWidth={2.2} /></span></button>
          <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 12.5, fontWeight: 600 }}>Today</button>
          <button onClick={() => move(1)} style={navBtn}><Icon name="chevronRight" size={15} strokeWidth={2.2} /></button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))" }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 700, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${c.border2}` }}>{w}</div>
        ))}
      </div>

      {weeks.map((week, w) => (
        // Two layers: the day cells paint the grid, the bars sit on top and can
        // therefore span columns without being clipped by a cell boundary.
        <div key={w} style={{ position: "relative", borderBottom: w < 5 ? `1px solid ${c.border2}` : "none" }}>
          <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))" }}>
            {week.days.map((d, i) => (
              <div key={i} style={{ borderRight: i !== 6 ? `1px solid ${c.border2}` : "none", background: d.getMonth() === cursor.getMonth() ? "#fff" : "#faf9f5" }} />
            ))}
          </div>

          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", alignContent: "start", rowGap: 3, minHeight: 108, padding: "7px 0 9px" }}>
            {week.days.map((d, i) => {
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = ymd(d) === todayStr;
              return (
                <div key={i} style={{ gridColumn: i + 1, gridRow: 1, padding: "0 7px", marginBottom: 2 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 21, height: 21, padding: "0 5px", borderRadius: 11, fontSize: 11.5, fontWeight: isToday ? 700 : 500, color: isToday ? "#fff" : inMonth ? c.body : c.faint, background: isToday ? c.green : "transparent" }}>{d.getDate()}</span>
                </div>
              );
            })}

            {week.segments.map((s) => {
              const cancelled = s.b.is_cancelled;
              const checkIn = new Date(s.b.check_in);
              const time = checkIn.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
              const range = `${checkIn.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} → ${new Date(s.b.check_out).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
              return (
                <button
                  key={`${s.b.id}-${s.col}`}
                  onClick={() => onSelect(s.b)}
                  title={`${s.b.guest_name || "Unnamed"} · ${range} · check-in ${time}${cancelled ? " · cancelled" : ""}`}
                  style={{
                    gridColumn: `${s.col + 1} / span ${s.span}`,
                    gridRow: s.lane + 2,
                    display: "flex", alignItems: "center", gap: 5,
                    minWidth: 0, textAlign: "left", border: "none",
                    // Flat edge on whichever side the stay continues into the
                    // next / previous week, so it reads as one run.
                    borderTopLeftRadius: s.startsHere ? 4 : 0, borderBottomLeftRadius: s.startsHere ? 4 : 0,
                    borderTopRightRadius: s.endsHere ? 4 : 0, borderBottomRightRadius: s.endsHere ? 4 : 0,
                    borderLeft: s.startsHere ? `2px solid ${cancelled ? c.faint : c.greenMid}` : "none",
                    marginLeft: s.startsHere ? 4 : 0, marginRight: s.endsHere ? 4 : 0,
                    padding: "3px 6px",
                    background: cancelled ? "#f0eee9" : "#e7f0ed",
                    color: cancelled ? "#6b665c" : "#21564b",
                    fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                    opacity: cancelled ? 0.75 : 1,
                    textDecoration: cancelled ? "line-through" : "none",
                  }}
                >
                  {s.startsHere && <span style={{ flex: "none", opacity: 0.85 }}>{time}</span>}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.b.guest_name || "Unnamed"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

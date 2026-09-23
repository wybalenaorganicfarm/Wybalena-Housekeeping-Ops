import { useMemo, useState } from "react";
import { c, font, BOOKING } from "../theme";
import { Icon } from "./Icon";
import {
  WEEKDAYS, ymd, dayStart, addDays,
  layoutWeek, initialMonth, type Segment, type Span,
} from "../lib/calendarLayout";
import type { Booking } from "../lib/types";

const navBtn = { width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.body, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;

export function BookingCalendar({ bookings, initialDate, onSelect }: {
  bookings: Booking[]; initialDate?: string; onSelect: (b: Booking) => void;
}) {
  const today = new Date();

  // Open on a month that holds bookings rather than an empty one.
  const [cursor, setCursor] = useState(() =>
    initialMonth(initialDate, bookings.map((b) => b.check_in.slice(0, 10)), today));

  // Check-out day is included: the guest is still on site that morning, and it
  // is the day the cleaning shift is created for.
  const spans = useMemo<Span<Booking>[]>(() => bookings.map((b) => {
    const s = dayStart(new Date(b.check_in));
    const e = dayStart(new Date(b.check_out));
    return { item: b, start: s, end: e < s ? s : e, sort: b.check_in };
  }), [bookings]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // back to Monday

  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => {
      const weekStart = addDays(gridStart, w * 7);
      return {
        weekStart,
        days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        segments: layoutWeek(spans, weekStart),
      };
    }),
    [spans, gridStart.getTime()],
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

            {week.segments.map((s: Segment<Booking>) => {
              const b = s.item;
              const cancelled = b.is_cancelled;
              const checkIn = new Date(b.check_in);
              const time = checkIn.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
              const range = `${checkIn.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} → ${new Date(b.check_out).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
              return (
                <button
                  key={`${b.id}-${s.col}`}
                  onClick={() => onSelect(b)}
                  title={`${b.guest_name || "Unnamed"} · ${range} · check-in ${time}${cancelled ? " · cancelled" : ""}`}
                  style={{
                    gridColumn: `${s.col + 1} / span ${s.span}`,
                    gridRow: s.lane + 2,
                    display: "flex", alignItems: "center", gap: 5,
                    minWidth: 0, textAlign: "left", border: "none",
                    // Flat edge on whichever side the stay continues into the
                    // next / previous week, so it reads as one run.
                    borderTopLeftRadius: s.startsHere ? 4 : 0, borderBottomLeftRadius: s.startsHere ? 4 : 0,
                    borderTopRightRadius: s.endsHere ? 4 : 0, borderBottomRightRadius: s.endsHere ? 4 : 0,
                    borderLeft: s.startsHere ? `2px solid ${cancelled ? BOOKING.cancelledDot : BOOKING.dot}` : "none",
                    marginLeft: s.startsHere ? 4 : 0, marginRight: s.endsHere ? 4 : 0,
                    padding: "3px 6px",
                    background: cancelled ? BOOKING.cancelledBg : BOOKING.bg,
                    color: cancelled ? BOOKING.cancelledFg : BOOKING.fg,
                    fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                    opacity: cancelled ? 0.75 : 1,
                    textDecoration: cancelled ? "line-through" : "none",
                  }}
                >
                  {s.startsHere && <span style={{ flex: "none", opacity: 0.85 }}>{time}</span>}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{b.guest_name || "Unnamed"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

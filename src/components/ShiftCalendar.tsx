import { useMemo, useState } from "react";
import { c, font, BOOKING, SHIFT_EVENT } from "../theme";
import { Icon } from "./Icon";
import { shiftBookingName, statusOf, typeColumn } from "../lib/format";
import {
  WEEKDAYS, ymd, dayStart, addDays, localDate,
  layoutWeek, laneCount, initialMonth, type Segment, type Span,
} from "../lib/calendarLayout";
import type { Booking, Shift } from "../lib/types";

const navBtn = { width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.body, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;

// Shared bar geometry. A run continuing into the next/previous week is drawn
// flat on that side so it reads as one bar, exactly like Google Calendar.
function barStyle(seg: { startsHere: boolean; endsHere: boolean }, accent: string, bg: string, fg: string) {
  return {
    display: "flex", alignItems: "center", gap: 5,
    minWidth: 0, textAlign: "left" as const, border: "none",
    borderTopLeftRadius: seg.startsHere ? 4 : 0, borderBottomLeftRadius: seg.startsHere ? 4 : 0,
    borderTopRightRadius: seg.endsHere ? 4 : 0, borderBottomRightRadius: seg.endsHere ? 4 : 0,
    borderLeft: seg.startsHere ? `2px solid ${accent}` : "none",
    marginLeft: seg.startsHere ? 4 : 0, marginRight: seg.endsHere ? 4 : 0,
    padding: "3px 6px", background: bg, color: fg,
    fontSize: 10.5, fontWeight: 600, cursor: "pointer",
    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" as const,
  };
}

export function ShiftCalendar({ shifts, bookings = {}, showBookings = false, initialDate, onSelect, onSelectBooking }: {
  shifts: Shift[]; bookings?: Record<string, Booking>;
  // When true, bookings render as continuous green bars spanning check-in to
  // check-out, stacked above the shift bars. Off by default so the Shifts-tab
  // calendar shows shifts only; the Dashboard turns it on.
  showBookings?: boolean;
  initialDate?: string; onSelect: (s: Shift) => void; onSelectBooking?: (b: Booking) => void;
}) {
  const today = new Date();

  // Open on a month that actually holds data. Landing on an empty month is what
  // makes the calendar look like it is not showing anything at all.
  const [cursor, setCursor] = useState(() =>
    initialMonth(initialDate, [
      ...shifts.map((s) => s.shift_date),
      ...(showBookings ? Object.values(bookings).map((b) => b.check_in.slice(0, 10)) : []),
    ], today));

  // Shifts are single-day: a one-column bar on their shift_date.
  const shiftSpans = useMemo<Span<Shift>[]>(() => shifts.map((s) => {
    const d = localDate(s.shift_date);
    return { item: s, start: d, end: d, sort: s.shift_date + s.start_time };
  }), [shifts]);

  // Bookings span check-in to check-out inclusive: the guest is still on site
  // the morning of check-out, and that is the day the cleaning shift is for.
  const bookingSpans = useMemo<Span<Booking>[]>(() => {
    if (!showBookings) return [];
    return Object.values(bookings).map((b) => {
      const s = dayStart(new Date(b.check_in));
      const e = dayStart(new Date(b.check_out));
      return { item: b, start: s, end: e < s ? s : e, sort: b.check_in };
    });
  }, [bookings, showBookings]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7)); // back to Monday

  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => {
      const weekStart = addDays(gridStart, w * 7);
      // Bookings take the upper lanes; shifts are offset below them so the two
      // never overlap within a week row.
      const bookingSegs = layoutWeek(bookingSpans, weekStart);
      const shiftSegs = layoutWeek(shiftSpans, weekStart, laneCount(bookingSegs));
      return { weekStart, days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), bookingSegs, shiftSegs };
    }),
    [bookingSpans, shiftSpans, gridStart.getTime()],
  );

  const todayStr = ymd(today);
  const monthLabel = cursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const move = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
          <h3 style={{ fontFamily: font.display, fontSize: 17, fontWeight: font.displayWeight, margin: 0 }}>{monthLabel}</h3>
          {/* Legend — names the two colours so purple vs green is unambiguous.
              Only shown when both kinds are actually on the grid. */}
          {showBookings && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, fontWeight: 600, color: c.muted2 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: BOOKING.bg, borderLeft: `2px solid ${BOOKING.dot}` }} />Booking
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: SHIFT_EVENT.bg, borderLeft: `2px solid ${SHIFT_EVENT.dot}` }} />Shift
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
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

            {/* Booking bars — green, spanning the whole stay. */}
            {week.bookingSegs.map((s: Segment<Booking>) => {
              const b = s.item;
              const cancelled = b.is_cancelled;
              const checkIn = new Date(b.check_in);
              const time = checkIn.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
              const range = `${checkIn.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} → ${new Date(b.check_out).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
              const guest = b.guest_name || "Unnamed booking";
              return (
                <button key={`b-${b.id}-${s.col}`} onClick={() => onSelectBooking?.(b)}
                  title={`${guest} · ${range} · check-in ${time}${cancelled ? " · cancelled" : ""}`}
                  style={{
                    ...barStyle(s,
                      cancelled ? BOOKING.cancelledDot : BOOKING.dot,
                      cancelled ? BOOKING.cancelledBg : BOOKING.bg,
                      cancelled ? BOOKING.cancelledFg : BOOKING.fg),
                    gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2,
                    opacity: cancelled ? 0.75 : 1,
                    textDecoration: cancelled ? "line-through" : "none",
                  }}>
                  {s.startsHere && <span style={{ flex: "none", opacity: 0.85 }}>{time}</span>}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{guest}</span>
                </button>
              );
            })}

            {/* Shift bars — always PURPLE, so they never read as a booking. The
                status still shows in the left-border accent and the tooltip. */}
            {week.shiftSegs.map((s: Segment<Shift>) => {
              const shift = s.item;
              const st = statusOf(shift);
              const cancelled = shift.status === "cancelled";
              const name = shiftBookingName(shift, bookings);
              return (
                <button key={`s-${shift.id}`} onClick={() => onSelect(shift)}
                  title={`${shift.start_time.slice(0, 5)} · ${name} · ${typeColumn(shift)} · ${st.label}`}
                  style={{
                    ...barStyle(s,
                      // Accent keeps the status colour (amber pending, purple
                      // staffing, green accepted) against the purple body.
                      cancelled ? SHIFT_EVENT.cancelledDot : st.dot,
                      cancelled ? SHIFT_EVENT.cancelledBg : SHIFT_EVENT.bg,
                      cancelled ? SHIFT_EVENT.cancelledFg : SHIFT_EVENT.fg),
                    gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2,
                    opacity: cancelled ? 0.75 : 1,
                    textDecoration: cancelled ? "line-through" : "none",
                  }}>
                  <span style={{ flex: "none", opacity: 0.85 }}>{shift.start_time.slice(0, 5)}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

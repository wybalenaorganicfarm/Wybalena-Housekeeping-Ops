import { useMemo, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "./Icon";
import { statusOf, typeColumn } from "../lib/format";
import type { Shift } from "../lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const navBtn = { width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.body, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;

export function ShiftCalendar({ shifts, initialDate, onSelect }: {
  shifts: Shift[]; initialDate?: string; onSelect: (s: Shift) => void;
}) {
  const today = new Date();
  const init = initialDate ? new Date(initialDate + "T00:00:00") : today;
  const [cursor, setCursor] = useState(new Date(init.getFullYear(), init.getMonth(), 1));

  const byDay = useMemo(() => {
    const m: Record<string, Shift[]> = {};
    for (const s of shifts) (m[s.shift_date] ??= []).push(s);
    for (const k in m) m[k].sort((a, b) => a.start_time.localeCompare(b.start_time));
    return m;
  }, [shifts]);

  // Grid starts on the Monday on/before the 1st; render 6 weeks (42 cells).
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d;
  });

  const todayStr = ymd(today);
  const monthLabel = cursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  const move = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${c.border}` }}>
        <h3 style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700, margin: 0 }}>{monthLabel}</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => move(-1)} style={navBtn}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevronRight" size={15} strokeWidth={2.2} /></span></button>
          <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 12.5, fontWeight: 600 }}>Today</button>
          <button onClick={() => move(1)} style={navBtn}><Icon name="chevronRight" size={15} strokeWidth={2.2} /></button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 700, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${c.border2}` }}>{w}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {cells.map((d, i) => {
          const ds = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayShifts = byDay[ds] ?? [];
          const isToday = ds === todayStr;
          return (
            <div key={i} style={{ minHeight: 108, borderRight: i % 7 !== 6 ? `1px solid ${c.border2}` : "none", borderBottom: i < 35 ? `1px solid ${c.border2}` : "none", padding: 7, background: inMonth ? "#fff" : "#faf9f5" }}>
              <div style={{ marginBottom: 2 }}>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 21, height: 21, padding: "0 5px", borderRadius: 11, fontSize: 11.5, fontWeight: isToday ? 700 : 500, color: isToday ? "#fff" : inMonth ? c.body : c.faint, background: isToday ? c.green : "transparent" }}>{d.getDate()}</span>
              </div>
              {dayShifts.map((s) => {
                const st = statusOf(s);
                return (
                  <button key={s.id} onClick={() => onSelect(s)} title={`${s.start_time.slice(0, 5)} · ${typeColumn(s)}`}
                    style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", textAlign: "left", border: "none", borderLeft: `2px solid ${st.dot}`, borderRadius: 4, padding: "3px 6px", marginTop: 4, background: st.bg, color: st.fg, fontSize: 10.5, fontWeight: 600, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    <span style={{ flex: "none", color: st.fg, opacity: 0.85 }}>{s.start_time.slice(0, 5)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{typeColumn(s)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

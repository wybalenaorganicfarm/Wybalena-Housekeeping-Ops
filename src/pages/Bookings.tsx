import { useEffect, useMemo, useState } from "react";
import { c } from "../theme";
import { Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { ShiftDrawer } from "../components/ShiftDrawer";
import { AssignModal } from "../components/AssignModal";
import { getBookings, getShifts } from "../lib/api";
import { dateTimeLabel, statusOf } from "../lib/format";
import type { Booking, Shift } from "../lib/types";

type Filter = "all" | "active" | "cancelled";
const COL = { dates: 200, nights: 80, guests: 80, shift: 150, status: 110 };

export function Bookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [shiftByBooking, setShiftByBooking] = useState<Record<string, Shift>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [drawer, setDrawer] = useState<Shift | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);

  async function load() {
    const [bs, ss] = await Promise.all([getBookings(), getShifts()]);
    setBookings(bs);
    const map: Record<string, Shift> = {};
    for (const s of ss) if (s.booking_id) map[s.booking_id] = s;
    setShiftByBooking(map);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    all: bookings.length,
    active: bookings.filter((b) => !b.is_cancelled).length,
    cancelled: bookings.filter((b) => b.is_cancelled).length,
  }), [bookings]);

  const filtered = useMemo(() => bookings.filter((b) =>
    filter === "all" ? true : filter === "cancelled" ? b.is_cancelled : !b.is_cancelled
  ), [bookings, filter]);

  const chips: [Filter, string][] = [["all", "All"], ["active", "Active"], ["cancelled", "Cancelled"]];

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Bookings" subtitle={`${bookings.length} synced from Google Calendar`} />

      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", gap: 7, padding: "10px 24px" }}>
        {chips.map(([k, l]) => {
          const on = filter === k;
          return (
            <span key={k} onClick={() => setFilter(k)} style={{ background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>
              {l} <span style={{ opacity: 0.8 }}>{counts[k]}</span>
            </span>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 18px", height: 38, background: c.tableHead, borderBottom: `1px solid ${c.border}`, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>
            <div style={{ flex: 1 }}>Guest / Booking</div>
            <div style={{ flex: "none", width: COL.dates }}>Check-in</div>
            <div style={{ flex: "none", width: COL.dates }}>Check-out</div>
            <div style={{ flex: "none", width: COL.nights }}>Nights</div>
            <div style={{ flex: "none", width: COL.guests }}>Guests</div>
            <div style={{ flex: "none", width: COL.shift }}>Cleaning shift</div>
            <div style={{ flex: "none", width: COL.status, textAlign: "right" }}>Status</div>
          </div>

          {filtered.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No bookings.</div>}
          {filtered.map((b) => {
            const shift = shiftByBooking[b.id];
            const ss = shift ? statusOf(shift) : null;
            return (
              <div key={b.id} onClick={() => shift && setDrawer(shift)} title={shift ? "Open cleaning shift" : undefined} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${c.rowBd}`, opacity: b.is_cancelled ? 0.65 : 1, cursor: shift ? "pointer" : "default" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.guest_name || "Unnamed booking"}</div>
                  <div style={{ fontSize: 11.5, color: c.faint }}>{b.gcal_event_id}</div>
                </div>
                <div style={{ flex: "none", width: COL.dates, fontSize: 12, color: "#5d665f" }}>{dateTimeLabel(b.check_in)}</div>
                <div style={{ flex: "none", width: COL.dates, fontSize: 12, color: "#5d665f" }}>{dateTimeLabel(b.check_out)}</div>
                <div style={{ flex: "none", width: COL.nights, fontSize: 12.5, color: c.body }}>{b.nights}</div>
                <div style={{ flex: "none", width: COL.guests, fontSize: 12.5, color: c.body }}>{b.guest_count ?? "—"}</div>
                <div style={{ flex: "none", width: COL.shift }}>
                  {ss
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: ss.bg, color: ss.fg, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 20 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: ss.dot }} />{ss.label}</span>
                    : <span style={{ fontSize: 12, color: c.faint }}>No shift</span>}
                </div>
                <div style={{ flex: "none", width: COL.status, textAlign: "right" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: b.is_cancelled ? "#a8392b" : "#2c6446" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.is_cancelled ? c.danger : c.greenMid }} />{b.is_cancelled ? "Cancelled" : "Confirmed"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {drawer && <ShiftDrawer shift={drawer} onClose={() => setDrawer(null)} onChanged={load} onAssign={(s) => { setDrawer(null); setAssign(s); }} />}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
    </div>
  );
}

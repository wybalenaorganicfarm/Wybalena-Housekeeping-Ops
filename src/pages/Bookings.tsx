import { useEffect, useMemo, useState } from "react";
import { c } from "../theme";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { ShiftDrawer } from "../components/ShiftDrawer";
import { BookingDrawer } from "../components/BookingDrawer";
import { BookingCalendar } from "../components/BookingCalendar";
import { AssignModal } from "../components/AssignModal";
import { getBookings, getShifts } from "../lib/api";
import { dateTimeLabel, statusOf } from "../lib/format";
import type { Booking, Shift } from "../lib/types";

type Filter = "all" | "active" | "cancelled";
type View = "list" | "calendar";
const COL = { dates: 200, nights: 80, guests: 80, shift: 150, status: 110 };

export function Bookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [shiftByBooking, setShiftByBooking] = useState<Record<string, Shift>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [bookingDrawer, setBookingDrawer] = useState<Booking | null>(null);
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

  const byFilter = useMemo(() => bookings.filter((b) =>
    filter === "all" ? true : filter === "cancelled" ? b.is_cancelled : !b.is_cancelled
  ), [bookings, filter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter((b) =>
      ((b.guest_name ?? "") + " " + (b.gcal_event_id ?? "") + " " + dateTimeLabel(b.check_in) + " " + dateTimeLabel(b.check_out)).toLowerCase().includes(q));
  }, [byFilter, search]);

  const chips: [Filter, string][] = [["all", "All"], ["active", "Active"], ["cancelled", "Cancelled"]];

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Bookings" subtitle={`${bookings.length} synced from Google Calendar`} />

      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 7 }}>
            {chips.map(([k, l]) => {
              const on = filter === k;
              return (
                <span key={k} onClick={() => setFilter(k)} style={{ background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>
                  {l} <span style={{ opacity: 0.8 }}>{counts[k]}</span>
                </span>
              );
            })}
          </div>
          {view === "list" && (
            <div style={{ position: "relative", width: 260 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.muted2, display: "flex", pointerEvents: "none" }}>
                <Icon name="search" size={14} strokeWidth={2} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bookings"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 28px 7px 30px", fontSize: 12.5, border: `1px solid ${c.border3}`, borderRadius: 8, outline: "none", color: c.ink, background: "#fff" }}
              />
              {search && (
                <span onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: c.muted2, cursor: "pointer", display: "flex" }}>
                  <Icon name="x" size={14} strokeWidth={2} />
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", background: "#eef0ec", borderRadius: 8, padding: 2 }}>
          {([["list", "List", "list"], ["calendar", "Calendar", "calendar"]] as [View, string, string][]).map(([k, lbl, ic]) => (
            <button key={k} onClick={() => setView(k)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 6, background: view === k ? "#fff" : "transparent", color: view === k ? c.ink : c.muted, boxShadow: view === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>
              <Icon name={ic} size={13} strokeWidth={2} /> {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {view === "calendar" ? (
          <BookingCalendar bookings={filtered} initialDate={filtered[0]?.check_in} onSelect={(b) => setBookingDrawer(b)} />
        ) : (
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

            {filtered.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>{search ? "No bookings match your search." : "No bookings."}</div>}
            {filtered.map((b) => {
              const shift = shiftByBooking[b.id];
              const ss = shift ? statusOf(shift) : null;
              return (
                <div key={b.id} onClick={() => setBookingDrawer(b)} title="View booking details" style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${c.rowBd}`, opacity: b.is_cancelled ? 0.65 : 1, cursor: "pointer" }}>
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
        )}
      </div>

      {bookingDrawer && (
        <BookingDrawer
          booking={bookingDrawer}
          shift={shiftByBooking[bookingDrawer.id]}
          onClose={() => setBookingDrawer(null)}
          onViewShift={(s) => { setBookingDrawer(null); setDrawer(s); }}
        />
      )}
      {drawer && <ShiftDrawer shift={drawer} onClose={() => setDrawer(null)} onChanged={load} onAssign={(s) => { setDrawer(null); setAssign(s); }} />}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
    </div>
  );
}

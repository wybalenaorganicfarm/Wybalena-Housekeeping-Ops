import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { c, font, TIER_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Button, Card, Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { ShiftDrawer } from "../components/ShiftDrawer";
import { BookingDrawer } from "../components/BookingDrawer";
import { ShiftCalendar } from "../components/ShiftCalendar";
import { NewShiftModal } from "../components/NewShiftModal";
import { AssignModal } from "../components/AssignModal";
import { confirmShifts, getAlerts, getBookings, getShifts, getStaffing } from "../lib/api";
import { useEscalationLabel } from "../lib/useEscalation";
import {
  countLabel, shiftBookingName, shortType, staffingDots, statusOf, timeParts, typeColumn, weekKey, weekRangeLabel,
} from "../lib/format";
import type { Alert, Booking, Shift, ShiftStaffing } from "../lib/types";

type View = "list" | "calendar";

const GRID = "26px 150px 92px 1fr 110px 110px 170px 110px";

export function Shifts() {
  const { canEdit } = useAuth();
  const escLabel = useEscalationLabel();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffing, setStaffing] = useState<Record<string, ShiftStaffing>>({});
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [urgentIds, setUrgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<Shift | null>(null);
  const [bookingDrawer, setBookingDrawer] = useState<Booking | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    const [s, st, a, b] = await Promise.all([getShifts(), getStaffing(), getAlerts(), getBookings()]);
    setShifts(s); setStaffing(st);
    setBookings(Object.fromEntries(b.map((x) => [x.id, x])));
    setUrgentIds(new Set(a.filter((x: Alert) => x.status === "open" && x.alert_type === "understaffed_urgent" && x.shift_id).map((x) => x.shift_id!)));
    setSel(new Set(s.filter((x) => x.status === "pending_confirmation").map((x) => x.id)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Always earliest-first, cancelled hidden — no filtering.
  const visible = useMemo(
    () => shifts.filter((s) => s.status !== "cancelled")
      .sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time)),
    [shifts],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((s) =>
      (shiftBookingName(s, bookings) + " " + dayDateMonth(s.shift_date) + " " + (s.source ?? "") + " " + typeColumn(s)).toLowerCase().includes(q));
  }, [visible, search, bookings]);

  const byWeek = useMemo(() => {
    const groups: Record<string, Shift[]> = {};
    for (const s of filtered) (groups[weekKey(s.shift_date)] ??= []).push(s);
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function toggleSel(id: string) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function bulkConfirm() {
    setBulkBusy(true);
    await confirmShifts([...sel]); await load();
    setBulkBusy(false);
  }
  async function confirmOne(id: string) {
    setConfirming((p) => new Set(p).add(id));
    await confirmShifts([id]); await load();
    setConfirming((p) => { const n = new Set(p); n.delete(id); return n; });
  }

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Shifts" right={canEdit ? (
        <Button onClick={() => setShowNew(true)}><Icon name="plus" size={14} strokeWidth={2.2} /> New shift</Button>
      ) : undefined} />

      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px" }}>
        {view === "list" ? (
          <div style={{ position: "relative", width: 280, maxWidth: "50%" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.muted2, display: "flex", pointerEvents: "none" }}>
              <Icon name="search" size={14} strokeWidth={2} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shifts"
              style={{ width: "100%", boxSizing: "border-box", padding: "7px 28px 7px 30px", fontSize: 12.5, border: `1px solid ${c.border3}`, borderRadius: 8, outline: "none", color: c.ink, background: "#fff" }}
            />
            {search && (
              <span onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: c.muted2, cursor: "pointer", display: "flex" }}>
                <Icon name="x" size={14} strokeWidth={2} />
              </span>
            )}
          </div>
        ) : <span />}
        <div style={{ display: "flex", background: "#eef0ec", borderRadius: 8, padding: 2 }}>
          {([["list", "List", "list"], ["calendar", "Calendar", "calendar"]] as [View, string, string][]).map(([k, lbl, ic]) => (
            <button key={k} onClick={() => setView(k)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 6, background: view === k ? "#fff" : "transparent", color: view === k ? c.ink : c.muted, boxShadow: view === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>
              <Icon name={ic} size={13} strokeWidth={2} /> {lbl}
            </button>
          ))}
        </div>
      </div>

      {canEdit && sel.size > 0 && view === "list" && (
        <div style={{ flex: "none", background: c.green, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 600 }}>
            <Icon name="check" size={16} strokeWidth={2.2} /> {sel.size} pending shift{sel.size === 1 ? "" : "s"} selected
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => setSel(new Set())} style={{ background: "none", border: "none", color: "#cfe0d6", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Clear</button>
            <Button onClick={bulkConfirm} disabled={bulkBusy} style={{ background: c.warn, padding: "7px 14px", fontSize: 12.5 }}>{bulkBusy ? "Confirming…" : `Confirm all ${sel.size}`}</Button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {view === "calendar" ? (
          <ShiftCalendar shifts={visible} bookings={bookings} initialDate={visible[0]?.shift_date} onSelect={(s) => setDrawer(s)} />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${c.border2}`, fontSize: 10.5, fontWeight: 700, color: c.muted2, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              <span />
              <span>Date</span>
              <span>Time</span>
              <span>Shift</span>
              <span>Source</span>
              <span>Type</span>
              <span>Staffing</span>
              <span style={{ textAlign: "right" }}>Action</span>
            </div>

            {byWeek.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>{search ? "No shifts match your search." : "No upcoming shifts."}</div>}
            {byWeek.map(([wk, weekShifts]) => (
              <div key={wk}>
                <div style={{ padding: "8px 16px", background: c.railGreenBg, borderBottom: `1px solid ${c.railGreenBd}`, fontSize: 10.5, fontWeight: 700, color: "#5e7a6a", textTransform: "uppercase", letterSpacing: "0.10em" }}>{weekRangeLabel(wk)}</div>
                {weekShifts.map((s) => {
                  const status = statusOf(s);
                  const tp = timeParts(s.start_time);
                  const dots = staffingDots(staffing[s.id], s.required_cleaners);
                  const urgent = urgentIds.has(s.id);
                  const selectable = canEdit && s.status === "pending_confirmation";
                  const tierTag = s.current_tier ? ` · ${TIER_LABEL[s.current_tier].toUpperCase()}` : "";
                  const badgeLabel = (urgent ? "Urgent" : status.label).toUpperCase() + tierTag;
                  const badgeFg = urgent ? c.danger : status.fg;
                  const badgeDot = urgent ? c.danger : status.dot;
                  const escalating = s.status === "staffing" && s.current_tier === "tier_2";
                  return (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "13px 16px", borderBottom: `1px solid ${c.border2}`, background: urgent ? "#fdf3f1" : "#fff", borderLeft: `3px solid ${urgent ? c.danger : status.dot}` }}>
                      <span onClick={(e) => e.stopPropagation()}>
                        {selectable && <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggleSel(s.id)} style={{ width: 15, height: 15, accentColor: c.green }} />}
                      </span>
                      <div onClick={() => setDrawer(s)} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>{dayDateMonth(s.shift_date)}</div>
                      <div onClick={() => setDrawer(s)} style={{ cursor: "pointer" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{tp.hour}:{tp.min}</div>
                        <div style={{ fontSize: 11, color: c.muted2, marginTop: 2 }}>{s.estimated_hours}h</div>
                      </div>
                      <div onClick={() => setDrawer(s)} style={{ cursor: "pointer", minWidth: 0, paddingRight: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shiftBookingName(s, bookings)}</span>
                          <span style={{ flex: "none", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "#2c6446", background: "#eaf3ed", borderRadius: 3, padding: "1px 6px" }}>{shortType(s)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", color: badgeFg }}>
                            {urgent ? <Icon name="alert" size={11} color={c.danger} strokeWidth={2.4} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: badgeDot }} />}
                            {badgeLabel}
                          </span>
                          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", color: s.venue_scope === "partial_venue" ? "#9a6512" : "#21564b", background: s.venue_scope === "partial_venue" ? "#fdf4e3" : "#e7f0ed", borderRadius: 3, padding: "1px 6px" }}>{s.venue_scope === "partial_venue" ? "Partial venue" : "Full venue"}</span>
                          {escalating && <span style={{ fontSize: 9.5, fontWeight: 700, color: c.warn }}>{escLabel ? `Tier 3 ${escLabel}` : "Escalating · Tier 3"}</span>}
                          {s.is_modified && <span style={{ fontSize: 9.5, color: c.muted2, border: `1px solid ${c.border3}`, borderRadius: 3, padding: "0 5px" }}>Edited</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: c.body }}>{s.source === "manual" ? "Manual" : "Auto"}</div>
                      <div style={{ fontSize: 12, color: c.body }}>{typeColumn(s)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, display: "flex", gap: 2 }}>
                          {dots.map((d, i) => <span key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: d }} />)}
                        </div>
                        <span style={{ fontSize: 11.5, color: urgent ? "#a8392b" : c.muted2, fontWeight: urgent ? 600 : 400, whiteSpace: "nowrap" }}>{countLabel(staffing[s.id], s.required_cleaners).replace(" confirmed", "")}</span>
                      </div>
                      <div style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        {canEdit && s.status === "pending_confirmation"
                          ? <Button kind="secondary" disabled={confirming.has(s.id)} onClick={() => confirmOne(s.id)} style={{ padding: "7px 13px", fontSize: 12 }}>{confirming.has(s.id) ? "Confirming…" : "Confirm"}</Button>
                          : canEdit && (s.status === "staffing" || urgent)
                            ? <Button kind="danger" onClick={() => setAssign(s)} style={{ padding: "7px 13px", fontSize: 12 }}>Assign</Button>
                            : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>
        )}
      </div>

      {drawer && (
        <ShiftDrawer
          shift={drawer}
          booking={drawer.booking_id ? bookings[drawer.booking_id] : undefined}
          onClose={() => setDrawer(null)}
          onChanged={load}
          onAssign={(s) => { setDrawer(null); setAssign(s); }}
          onViewBooking={(b) => { setDrawer(null); setBookingDrawer(b); }}
        />
      )}
      {bookingDrawer && (
        <BookingDrawer
          booking={bookingDrawer}
          shift={shifts.find((s) => s.booking_id === bookingDrawer.id)}
          onClose={() => setBookingDrawer(null)}
          onViewShift={(s) => { setBookingDrawer(null); setDrawer(s); }}
        />
      )}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
      {showNew && <NewShiftModal onClose={() => setShowNew(false)} onCreated={load} onManualAssign={(s) => { setShowNew(false); setAssign(s); }} />}
    </div>
  );
}

// "Mon 6 July" — full day/date/month even inside a week-range group.
function dayDateMonth(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long" });
}

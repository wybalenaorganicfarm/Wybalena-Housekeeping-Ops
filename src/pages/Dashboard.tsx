import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import {
  confirmCancellation, confirmShifts, dismissAlert, getAlerts, getBookings,
  getShifts, getStaffing,
} from "../lib/api";
import {
  countLabel, dateLabel, dateTimeLabel, longDateLabel, shiftBookingName,
  shiftTitle, staffingDots, statusOf, timeParts, typeLabel, weekKey,
  weekRangeLabel,
} from "../lib/format";
import { useEscalationLabel } from "../lib/useEscalation";
import type { Alert, Booking, Shift, ShiftStaffing } from "../lib/types";

function Kpi({ icon, color, label, value, sub }: { icon: string; color: string; label: string; value: number; sub: string }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <Icon name={icon} size={14} strokeWidth={2.2} /> {label}
      </div>
      <div style={{ fontFamily: font.display, fontSize: 32, fontWeight: font.displayWeight, marginTop: 10, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{sub}</div>
    </Card>
  );
}

// "Mon 6 July" — each row carries its own full day/date/month (matches the
// Shifts page).
function dayDateMonth(dateStr: string): string {
  return new Date(dateStr + "T00:00:00")
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long" });
}

type View = "agenda" | "calendar";
type Scope = "upcoming" | "past" | "all";

// Local YYYY-MM-DD for "today" so the past/upcoming split matches the user's
// calendar day (shift_date is a plain date, no timezone).
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One authoritative agenda-table track shared by the header row AND every data
// row — the same Grid pattern the Cleaners table uses, so header and body can
// never drift out of alignment (a per-cell width can't distort a fixed track).
// Widths are px so the columns stay legible; the table gets a min-width floor and
// horizontal scroll on narrow screens (see the `.dash-agenda` rules) rather than
// crushing. Booking flexes to fill the remainder.
const AGENDA_GRID = "150px 96px 140px minmax(140px,1fr) 190px 172px 110px";
const agendaRow = { display: "grid", gridTemplateColumns: AGENDA_GRID, alignItems: "center" } as const;

const ALERT_ICON: Record<string, string> = {
  understaffed_urgent: "alert",
  booking_cancelled: "calendar",
  venue_gap: "cloud",
  mid_retreat_needed: "sunrise",
  unconfirmed_shifts: "clock",
  cleaner_cancelled: "user",
  connection_down: "cloud",
  shift_moved: "calendar",
};
const ALERT_COLOR: Record<string, string> = {
  understaffed_urgent: c.danger,
  booking_cancelled: c.teal,
  venue_gap: c.muted2,
  mid_retreat_needed: c.warn,
  unconfirmed_shifts: c.warn,
  cleaner_cancelled: c.danger,
  shift_moved: c.warn,
  connection_down: c.danger,
};

export function Dashboard() {
  const { canEdit, isTeamLead, profile } = useAuth();
  const escLabel = useEscalationLabel();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffing, setStaffing] = useState<Record<string, ShiftStaffing>>({});
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<Shift | null>(null);
  const [bookingDrawer, setBookingDrawer] = useState<Booking | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<View>("agenda");
  const [scope, setScope] = useState<Scope>("upcoming");
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});

  async function load() {
    const [s, st, a, b] = await Promise.all([getShifts(), getStaffing(), getAlerts(), getBookings()]);
    setShifts(s); setStaffing(st); setAlerts(a);
    setBookings(Object.fromEntries(b.map((x) => [x.id, x])));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Deep-link from the confirmation email's "Edit Shift" button: /?edit=<shiftId>
  // opens that shift's drawer (which exposes Confirm + Edit), then clears the param.
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId || loading) return;
    const target = shifts.find((s) => s.id === editId);
    if (target) setDrawer(target);
    searchParams.delete("edit");
    setSearchParams(searchParams, { replace: true });
  }, [loading, shifts, searchParams, setSearchParams]);

  const active = useMemo(() => shifts.filter((s) => s.status !== "cancelled"), [shifts]);
  const kpis = useMemo(() => ({
    pending: active.filter((s) => s.status === "pending_confirmation").length,
    urgent: alerts.filter((a) => a.status === "open" && a.alert_type === "understaffed_urgent").length,
    staffing: active.filter((s) => s.status === "staffing").length,
    staffed: active.filter((s) => s.status === "fully_staffed").length,
  }), [active, alerts]);

  const pendingShifts = useMemo(() => active.filter((s) => s.status === "pending_confirmation"), [active]);

  const openAlerts = alerts.filter((a) => a.status === "open");
  const urgentIds = useMemo(
    () => new Set(alerts.filter((a) => a.status === "open" && a.alert_type === "understaffed_urgent" && a.shift_id).map((a) => a.shift_id!)),
    [alerts],
  );

  // Agenda scope. "upcoming" (default) = today onward, earliest first — the
  // original behaviour. "past" = before today, most-recent first. "all" =
  // everything, earliest first. Grouped by week so the green header states the
  // range, matching the Shifts page layout.
  const today = todayKey();
  const agenda = useMemo(() => {
    const rows = scope === "upcoming" ? active.filter((s) => s.shift_date >= today)
      : scope === "past" ? active.filter((s) => s.shift_date < today)
      : active;
    const asc = scope !== "past";
    return [...rows].sort((a, b) => {
      const cmp = (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time);
      return asc ? cmp : -cmp;
    });
  }, [active, scope, today]);
  const byWeek = useMemo(() => {
    const groups: Record<string, Shift[]> = {};
    for (const s of agenda) (groups[weekKey(s.shift_date)] ??= []).push(s);
    const entries = Object.entries(groups);
    return entries.sort((a, b) => scope === "past" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
  }, [agenda, scope]);

  const attention = kpis.pending + kpis.urgent + kpis.staffing;

  async function confirm(id: string) {
    setConfirming((c) => ({ ...c, [id]: true }));
    const { error } = await confirmShifts([id]);
    setConfirming((c) => ({ ...c, [id]: false }));
    if (error) return;
    // Optimistic: flip to confirmed locally instead of refetching everything.
    setShifts((prev) => prev.map((s) => s.id === id ? { ...s, status: "confirmed" } : s));
    setAlerts((prev) => prev.filter((a) => !(a.alert_type === "unconfirmed_shifts" && a.shift_id === id)));
    setDrawer((d) => d && d.id === id ? { ...d, status: "confirmed" } : d);
  }

  if (loading) return <Spinner />;

  return (
    <div className="dash-page" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {/* Responsive rules scoped to this page only via `.dash-page` — nothing
          leaks to other pages or the shared layout. Reuses the app's established
          1024/900/640/480 breakpoints (same as the Cleaners/Shifts pages). */}
      <style>{`
        /* Stat cards: 4 across on desktop → 2×2 tablet → stacked on phone. */
        @media (max-width: 1024px) { .dash-page .dash-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 520px)  { .dash-page .dash-kpis { grid-template-columns: 1fr; } }
        /* Right rail drops below the main content (full width) once the row is
           too narrow to give it a readable 296px without squeezing the agenda. */
        @media (max-width: 900px) {
          .dash-page .dash-body { flex-direction: column; overflow-y: auto; }
          .dash-page .dash-main { overflow-y: visible; }
          .dash-page .dash-rail { width: auto; border-left: none; border-top: 1px solid ${c.border2}; overflow-y: visible; }
        }
        /* Agenda table: wide fixed track scrolls horizontally instead of crushing;
           header + rows share the same min-width track so they scroll aligned. */
        @media (max-width: 860px) {
          .dash-page .dash-agenda { overflow-x: auto; }
          .dash-page .dash-agenda > * { min-width: 858px; }
        }
        /* Calendar: shrink day cells on phones so a 7-col month isn't cramped. */
        @media (max-width: 640px) {
          .dash-page .dash-main { padding-left: 14px; padding-right: 14px; }
        }
      `}</style>
      <PageHeader
        title={`Good morning, ${profile?.full_name?.split(" ")[0] ?? "there"}`}
        subtitle={`${longDateLabel(new Date())} · ${attention} shift${attention === 1 ? "" : "s"} need your attention this week`}
        right={canEdit ? (
          <>
            <Button kind="secondary" onClick={() => navigate("/shifts")}><Icon name="search" size={14} strokeWidth={2.2} /> Search</Button>
            <Button onClick={() => setShowNew(true)}><Icon name="plus" size={14} strokeWidth={2.2} /> New shift</Button>
          </>
        ) : undefined}
      />
      <div className="dash-body" style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* center */}
        <div className="dash-main" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px 40px" }}>
          <div className="dash-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14, marginBottom: 22 }}>
            <Kpi icon="clock" color={c.warn} label="Pending" value={kpis.pending} sub="awaiting confirm" />
            <Kpi icon="alert" color={c.danger} label="Urgent" value={kpis.urgent} sub="understaffed" />
            <Kpi icon="target" color={c.teal} label="Staffing" value={kpis.staffing} sub="in tier offers" />
            <Kpi icon="check" color={c.greenMid} label="Staffed" value={kpis.staffed} sub="fully booked" />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, margin: "0 0 16px" }}>
            <h2 style={{ fontFamily: font.display, fontSize: 20, fontWeight: font.displayWeight, margin: 0 }}>{scope === "past" ? "Past agenda" : scope === "all" ? "All shifts" : "Upcoming agenda"}</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              {view === "agenda" && (
                <div style={{ display: "flex", background: "#ece8df", borderRadius: 8, padding: 2 }}>
                  {([["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]] as [Scope, string][]).map(([k, lbl]) => (
                    <button key={k} onClick={() => setScope(k)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: scope === k ? "#fff" : "transparent", color: scope === k ? c.ink : c.muted, boxShadow: scope === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>{lbl}</button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", background: "#ece8df", borderRadius: 8, padding: 2 }}>
                {([["agenda", "Agenda"], ["calendar", "Calendar"]] as [View, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setView(k)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: view === k ? "#fff" : "transparent", color: view === k ? c.ink : c.muted, boxShadow: view === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>

          {view === "calendar" ? (
            <ShiftCalendar shifts={active} bookings={bookings} showBookings initialDate={agenda[0]?.shift_date} onSelect={(s) => setDrawer(s)} onSelectBooking={(b) => setBookingDrawer(b)} />
          ) : agenda.length === 0 ? (
            <Card style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>{scope === "past" ? "No past shifts." : scope === "all" ? "No shifts." : "No upcoming shifts."}</Card>
          ) : (
            <div className="dash-agenda" style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ ...agendaRow, padding: "0 18px", height: 38, background: c.tableHead, borderBottom: `1px solid ${c.border}`, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>
                <div>Date</div>
                <div>Time</div>
                <div>Type</div>
                <div>Booking</div>
                <div>Notes</div>
                <div>Staffing</div>
                <div style={{ textAlign: "right" }}>Action</div>
              </div>

              {byWeek.map(([wk, weekShifts]) => (
                <div key={wk}>
                  <div style={{ padding: "8px 18px", background: c.railGreenBg, borderBottom: `1px solid ${c.railGreenBd}`, fontSize: 10.5, fontWeight: 700, color: "#5e7a6a", textTransform: "uppercase", letterSpacing: "0.08em" }}>{weekRangeLabel(wk)}</div>
                  {weekShifts.map((s) => {
                    const status = statusOf(s);
                    const tp = timeParts(s.start_time);
                    const dots = staffingDots(staffing[s.id], s.required_cleaners);
                    const urgent = urgentIds.has(s.id);
                    const tierTag = s.current_tier ? ` · ${TIER_LABEL[s.current_tier]}` : "";
                    const badgeLabel = (urgent ? "Urgent" : status.label) + tierTag;
                    const escalating = s.status === "staffing" && s.current_tier === "tier_2";
                    const booking = s.booking_id ? bookings[s.booking_id] : undefined;
                    return (
                      <div key={s.id} style={{ ...agendaRow, padding: "13px 18px", borderBottom: `1px solid ${c.rowBd}`, background: urgent ? "#fdf3f1" : "#fff" }}>
                        <div onClick={() => setDrawer(s)} style={{ minWidth: 0, cursor: "pointer" }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{dayDateMonth(s.shift_date)}</div>
                          <span title={escalating && escLabel ? `Tier 3 ${escLabel}` : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 3, background: urgent ? "#fbe9e6" : status.bg, color: urgent ? "#a8392b" : status.fg, fontSize: 10, fontWeight: 600, padding: "1px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
                            <span style={{ width: 5, height: 5, borderRadius: "50%", background: urgent ? c.danger : status.dot }} />{badgeLabel}
                          </span>
                        </div>
                        <div onClick={() => setDrawer(s)} style={{ minWidth: 0, cursor: "pointer" }}>
                          <div style={{ fontSize: 12.5, color: c.body }}>{tp.hour}:{tp.min}</div>
                          <div style={{ fontSize: 11, color: c.faint, marginTop: 2 }}>{s.estimated_hours}h</div>
                        </div>
                        <div onClick={() => setDrawer(s)} style={{ minWidth: 0, cursor: "pointer" }}>
                          <div style={{ fontSize: 12.5, color: c.body }}>{typeLabel(s)}</div>
                          {s.venue_scope === "partial_venue" && (
                            <div style={{ fontSize: 11, color: c.faint, marginTop: 2 }}>Partial Venue</div>
                          )}
                        </div>
                        <div onClick={() => setDrawer(s)} style={{ minWidth: 0, cursor: "pointer", paddingRight: 12 }}>
                          {booking ? (
                            <>
                              <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{booking.guest_name || "Unnamed booking"}</div>
                              <div style={{ fontSize: 11.5, color: c.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Check-out {dateTimeLabel(booking.check_out)}</div>
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: c.muted2 }}>{shiftBookingName(s, bookings)}</div>
                          )}
                        </div>
                        <div onClick={() => setDrawer(s)} title={s.special_instructions ?? undefined} style={{ minWidth: 0, cursor: "pointer", paddingRight: 12 }}>
                          {s.special_instructions ? (
                            <div style={{ fontSize: 12, color: c.body, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 }}>
                              {s.special_instructions}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: "#c4bdb0" }}>—</span>
                          )}
                        </div>
                        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, paddingRight: 12 }}>
                          <div style={{ flex: 1, display: "flex", gap: 2 }}>
                            {dots.map((d, i) => <span key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: d }} />)}
                          </div>
                          <span style={{ fontSize: 11.5, color: urgent ? "#a8392b" : c.muted2, fontWeight: urgent ? 600 : 400, whiteSpace: "nowrap" }}>{countLabel(staffing[s.id], s.required_cleaners).replace(" confirmed", "")}</span>
                        </div>
                        <div style={{ minWidth: 0, textAlign: "right", display: "flex", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                          {canEdit && s.status === "pending_confirmation"
                            ? <Button kind="secondary" disabled={confirming[s.id]} onClick={() => confirm(s.id)} style={{ padding: "7px 13px", fontSize: 12 }}>{confirming[s.id] ? "Confirming…" : "Confirm"}</Button>
                            : canEdit && (s.status === "staffing" || urgent)
                              ? <Button kind="danger" onClick={() => setAssign(s)} style={{ padding: "7px 13px", fontSize: 12 }}>Offer</Button>
                              : <Button kind="secondary" onClick={() => setDrawer(s)} style={{ padding: "7px 13px", fontSize: 12 }}>View</Button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* right rail — pending shifts + alerts queue. Hidden for the team lead:
            neither is theirs to action, so their dashboard is just the agenda. */}
        {!isTeamLead && (
        <div className="dash-rail" style={{ flex: "none", width: 296, background: c.rail, borderLeft: `1px solid ${c.border2}`, overflowY: "auto", padding: "22px 18px 40px" }}>
          {canEdit && pendingShifts.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: font.displayWeight }}>Shifts to be scheduled</div>
                  <span style={{ background: "#FBF1DF", color: c.warn, fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "1px 9px" }}>{pendingShifts.length}</span>
                </div>
              </div>
              {pendingShifts.map((s) => {
                const tp = timeParts(s.start_time);
                return (
                  <Card key={s.id} onClick={() => setDrawer(s)} style={{ padding: 13, marginBottom: 10, cursor: "pointer" }}>
                    <div style={{ display: "flex", gap: 9 }}>
                      <Icon name="clock" size={15} color={c.warn} strokeWidth={2} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{shiftTitle(s)}</div>
                        <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, lineHeight: 1.4 }}>{dateLabel(s.shift_date)} · {tp.hour}:{tp.min}</div>
                        <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 9 }} onClick={(e) => e.stopPropagation()}>
                          <Button onClick={() => confirm(s.id)} loading={confirming[s.id]} style={{ padding: "6px 11px", fontSize: 11.5 }}>Confirm</Button>
                          <Button kind="secondary" onClick={() => setDrawer(s)} style={{ padding: "6px 11px", fontSize: 11.5 }}>View</Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: font.displayWeight }}>Alerts</div>
              <span style={{ background: c.dangerBg, color: c.danger, fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "1px 9px" }}>{openAlerts.length}</span>
            </div>
            <button onClick={() => navigate("/alerts")} style={{ background: "none", border: "none", color: c.muted2, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>View all</button>
          </div>
          {openAlerts.length === 0 && <Card style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: c.faint }}>No active alerts. All clear!</Card>}
          {openAlerts.map((a) => {
            const ic = ALERT_ICON[a.alert_type] ?? "alert";
            const col = ALERT_COLOR[a.alert_type] ?? c.muted2;
            const shift = a.shift_id ? active.find((s) => s.id === a.shift_id) : undefined;
            return (
              <Card key={a.id} style={{ padding: 13, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 9 }}>
                  <Icon name={ic} size={15} color={col} strokeWidth={2} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</div>
                    {a.body && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, lineHeight: 1.4 }}>{a.body}</div>}
                    {canEdit && (
                      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 9 }}>
                        {a.alert_type === "booking_cancelled" ? (
                          <>
                            <Button kind="danger" onClick={async () => { await confirmCancellation(a.id); await load(); }} style={{ padding: "6px 11px", fontSize: 11.5 }}>Confirm cancel</Button>
                            <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>No action</button>
                          </>
                        ) : a.alert_type === "understaffed_urgent" || a.alert_type === "cleaner_cancelled" ? (
                          <>
                            <button onClick={() => shift && setAssign(shift)} style={{ background: "none", border: "none", color: c.danger, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>Assign manually <Icon name="arrowRight" size={13} strokeWidth={2.2} /></button>
                            {a.alert_type === "cleaner_cancelled" && <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>}
                          </>
                        ) : a.alert_type === "venue_gap" || a.alert_type === "mid_retreat_needed" ? (
                          <button onClick={() => setShowNew(true)} style={{ background: "none", border: "none", color: c.teal, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>Plan a clean <Icon name="arrowRight" size={13} strokeWidth={2.2} /></button>
                        ) : a.alert_type === "connection_down" ? (
                          // Same route as the Alerts page: Connections re-probes on
                          // open, which is what clears this alert once it's fixed.
                          <>
                            <button onClick={() => navigate("/connections")} style={{ background: "none", border: "none", color: c.danger, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>Reconnect <Icon name="arrowRight" size={13} strokeWidth={2.2} /></button>
                            <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                          </>
                        ) : (
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        )}
      </div>

      {drawer && <ShiftDrawer shift={drawer} booking={drawer.booking_id ? bookings[drawer.booking_id] : undefined} bookings={bookings} bookingHasCheckoutClean={(bid) => shifts.some((x) => x.booking_id === bid && x.shift_type === "standard" && x.status !== "cancelled")} onClose={() => setDrawer(null)} onChanged={load} onAssign={(s) => { setDrawer(null); setAssign(s); }} onViewBooking={(b) => { setDrawer(null); setBookingDrawer(b); }} />}
      {bookingDrawer && (
        <BookingDrawer
          booking={bookingDrawer}
          shifts={shifts
            .filter((s) => s.booking_id === bookingDrawer.id)
            .sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time))}
          onClose={() => setBookingDrawer(null)}
          onViewShift={(s) => { setBookingDrawer(null); setDrawer(s); }}
        />
      )}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
      {showNew && <NewShiftModal onClose={() => setShowNew(false)} onCreated={load} onManualAssign={(s) => { setShowNew(false); setAssign(s); }} />}
    </div>
  );
}

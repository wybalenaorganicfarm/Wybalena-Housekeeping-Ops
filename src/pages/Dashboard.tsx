import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { c, font, TIER_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Badge, Button, Card, Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { ShiftDrawer } from "../components/ShiftDrawer";
import { ShiftCalendar } from "../components/ShiftCalendar";
import { NewShiftModal } from "../components/NewShiftModal";
import { AssignModal } from "../components/AssignModal";
import {
  confirmCancellation, confirmShifts, dismissAlert, getAlerts, getBookings,
  getShifts, getStaffing,
} from "../lib/api";
import {
  countLabel, dateLabel, longDateLabel, shiftSubtitle, shiftTitle, shortType,
  staffingDots, statusOf, timeParts,
} from "../lib/format";
import { useEscalationLabel } from "../lib/useEscalation";
import type { Alert, Booking, Shift, ShiftStaffing } from "../lib/types";

function Kpi({ icon, color, label, value, sub }: { icon: string; color: string; label: string; value: number; sub: string }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        <Icon name={icon} size={14} strokeWidth={2.2} /> {label}
      </div>
      <div style={{ fontFamily: font.display, fontSize: 32, fontWeight: 700, marginTop: 10, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{sub}</div>
    </Card>
  );
}

type View = "agenda" | "calendar";

const TYPE_BADGE: Record<string, { bg: string; fg: string }> = {
  standard: { bg: "#eaf3ed", fg: "#2c6446" },
  deep_full_venue: { bg: "#f0e9f5", fg: "#6b4a86" },
  mid_retreat: { bg: "#eef3ef", fg: "#21564b" },
  other: { bg: "#eef3ef", fg: "#21564b" },
};

const ALERT_ICON: Record<string, string> = {
  understaffed_urgent: "alert",
  booking_cancelled: "calendar",
  venue_gap: "cloud",
  unconfirmed_shifts: "clock",
  cleaner_cancelled: "user",
};
const ALERT_COLOR: Record<string, string> = {
  understaffed_urgent: c.danger,
  booking_cancelled: c.teal,
  venue_gap: c.muted2,
  unconfirmed_shifts: c.warn,
  cleaner_cancelled: c.danger,
};

export function Dashboard() {
  const { canEdit, profile } = useAuth();
  const escLabel = useEscalationLabel();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staffing, setStaffing] = useState<Record<string, ShiftStaffing>>({});
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<Shift | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<View>("agenda");
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});

  async function load() {
    const [s, st, a, b] = await Promise.all([getShifts(), getStaffing(), getAlerts(), getBookings()]);
    setShifts(s); setStaffing(st); setAlerts(a);
    setBookings(Object.fromEntries(b.map((x) => [x.id, x])));
    setLoading(false);
  }
  // Booking (guest) name for a shift; falls back to the clean-type label for
  // manual shifts with no linked booking.
  const shiftName = (s: Shift) => (s.booking_id && bookings[s.booking_id]?.guest_name) || shiftTitle(s);
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

  const byDay = useMemo(() => {
    const groups: Record<string, Shift[]> = {};
    for (const s of [...active].sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time))) {
      (groups[s.shift_date] ??= []).push(s);
    }
    return Object.entries(groups);
  }, [active]);

  const openAlerts = alerts.filter((a) => a.status === "open");
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
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader
        title={`Good morning, ${profile?.full_name?.split(" ")[0] ?? "there"}`}
        titleStyle={{ fontFamily: font.body }}
        subtitle={`${longDateLabel(new Date())} · ${attention} shift${attention === 1 ? "" : "s"} need your attention this week`}
        right={canEdit ? (
          <>
            <Button kind="secondary" onClick={() => navigate("/shifts")}><Icon name="search" size={14} strokeWidth={2.2} /> Search</Button>
            <Button onClick={() => setShowNew(true)}><Icon name="plus" size={14} strokeWidth={2.2} /> New shift</Button>
          </>
        ) : undefined}
      />
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* center */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px 40px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14, marginBottom: 22 }}>
            <Kpi icon="clock" color={c.warn} label="Pending" value={kpis.pending} sub="awaiting confirm" />
            <Kpi icon="alert" color={c.danger} label="Urgent" value={kpis.urgent} sub="understaffed" />
            <Kpi icon="target" color={c.teal} label="Staffing" value={kpis.staffing} sub="in tier offers" />
            <Kpi icon="check" color={c.greenMid} label="Staffed" value={kpis.staffed} sub="fully booked" />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 16px" }}>
            <h2 style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, margin: 0 }}>Upcoming agenda</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", background: "#ece8df", borderRadius: 8, padding: 2 }}>
                {([["agenda", "Agenda"], ["calendar", "Calendar"]] as [View, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setView(k)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: view === k ? "#fff" : "transparent", color: view === k ? c.ink : c.muted, boxShadow: view === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>

          {view === "calendar" ? (
            <ShiftCalendar shifts={active} bookings={bookings} initialDate={byDay[0]?.[0]} onSelect={(s) => setDrawer(s)} />
          ) : byDay.length === 0 ? (
            <Card style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No upcoming shifts.</Card>
          ) : byDay.map(([day, dayShifts]) => (
            <div key={day}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#5e7a6a", textTransform: "uppercase", letterSpacing: "0.10em", margin: "20px 0 10px", padding: "7px 12px", background: c.railGreenBg, borderRadius: 6, border: `1px solid ${c.railGreenBd}` }}>
                {dateLabel(day)} <span style={{ fontWeight: 500, color: "#7fa491", textTransform: "none" }}>· {dayShifts.length} shift{dayShifts.length === 1 ? "" : "s"}</span>
              </div>
              {dayShifts.map((s) => {
                const status = statusOf(s);
                const tp = timeParts(s.start_time);
                const dots = staffingDots(staffing[s.id], s.required_cleaners);
                const tierLabel = s.status === "staffing" && s.current_tier ? `${status.label} · ${TIER_LABEL[s.current_tier]}` : status.label;
                const escalating = s.status === "staffing" && s.current_tier === "tier_2";
                return (
                  <Card key={s.id} onClick={() => setDrawer(s)} style={{ padding: "15px 16px", marginBottom: 10, borderLeft: `3px solid ${status.dot}`, display: "flex", alignItems: "center", gap: 18, cursor: "pointer" }}>
                    <div style={{ textAlign: "center", flex: "none", width: 42 }}>
                      <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.1 }}>{tp.hour}</div>
                      <div style={{ fontSize: 11, color: c.muted2 }}>:{tp.min.split(" ")[0]}</div>
                      <div style={{ fontSize: 10, color: c.faint, marginTop: 2 }}>{s.estimated_hours}h</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                        <Badge label={shortType(s)} bg={(TYPE_BADGE[s.shift_type] ?? TYPE_BADGE.other).bg} fg={(TYPE_BADGE[s.shift_type] ?? TYPE_BADGE.other).fg} />
                        <Badge label={tierLabel} dot={status.dot} bg={status.bg} fg={status.fg} />
                        {escalating && <Badge label={escLabel ? `Tier 3 ${escLabel}` : "Escalating · Tier 3"} bg="#eaf4ee" fg="#256b43" />}
                        <Badge label={s.source === "manual" ? "Manual" : "Auto"} bg={s.source === "manual" ? "#e7f0ed" : "#f0eee9"} fg={s.source === "manual" ? "#21564b" : "#6b665c"} />
                        {s.is_modified && <span style={{ fontSize: 10, color: c.muted2, border: `1px solid ${c.border3}`, borderRadius: 3, padding: "0 5px" }}>Edited</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{shiftName(s)}</div>
                      <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{shiftSubtitle(s, staffing[s.id])}</div>
                    </div>
                    <div style={{ flex: "none", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 3, marginBottom: 5, justifyContent: "center", flexWrap: "wrap", maxWidth: 120 }}>
                        {dots.map((d, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: d }} />)}
                      </div>
                      <div style={{ fontSize: 11, color: c.muted }}>{countLabel(staffing[s.id], s.required_cleaners)}</div>
                    </div>
                    <div style={{ flex: "none" }} onClick={(e) => e.stopPropagation()}>
                      {canEdit && s.status === "pending_confirmation"
                        ? <Button onClick={() => confirm(s.id)} loading={confirming[s.id]} style={{ borderRadius: 9 }}>Confirm</Button>
                        : canEdit && s.status === "staffing"
                          ? <Button kind="danger" onClick={() => setAssign(s)} style={{ borderRadius: 9 }}>Assign</Button>
                          : <Button kind="secondary" onClick={() => setDrawer(s)} style={{ borderRadius: 9 }}>View</Button>}
                    </div>
                  </Card>
                );
              })}
            </div>
          ))}
        </div>

        {/* right rail */}
        <div style={{ flex: "none", width: 296, background: c.rail, borderLeft: `1px solid ${c.border2}`, overflowY: "auto", padding: "22px 18px 40px" }}>
          {canEdit && pendingShifts.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Shifts to be scheduled</div>
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
              <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Alerts</div>
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
                        ) : a.alert_type === "venue_gap" ? (
                          <button onClick={() => setShowNew(true)} style={{ background: "none", border: "none", color: c.teal, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>Plan a clean <Icon name="arrowRight" size={13} strokeWidth={2.2} /></button>
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
      </div>

      {drawer && <ShiftDrawer shift={drawer} onClose={() => setDrawer(null)} onChanged={load} onAssign={(s) => { setDrawer(null); setAssign(s); }} />}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
      {showNew && <NewShiftModal onClose={() => setShowNew(false)} onCreated={load} onManualAssign={(s) => { setShowNew(false); setAssign(s); }} />}
    </div>
  );
}

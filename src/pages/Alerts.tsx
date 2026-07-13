import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { Spin, Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { ShiftDrawer } from "../components/ShiftDrawer";
import { AssignModal } from "../components/AssignModal";
import { confirmCancellation, confirmShifts, dismissAlert, getAlerts, getShifts } from "../lib/api";
import { timeLabel } from "../lib/format";
import type { Alert, AlertType, Shift } from "../lib/types";

const META: Record<AlertType, { icon: string; accent: string; iconBg: string; badge: string; badgeBg: string; badgeFg: string }> = {
  understaffed_urgent: { icon: "alert", accent: c.danger, iconBg: "#F8E5E1", badge: "Urgent", badgeBg: "#F8E5E1", badgeFg: "#a8392b" },
  booking_cancelled: { icon: "calendar", accent: c.warn, iconBg: "#FBF1DF", badge: "Needs review", badgeBg: "#FBF1DF", badgeFg: "#9a7320" },
  venue_gap: { icon: "sunrise", accent: c.warn, iconBg: "#FBF1DF", badge: "Plan ahead", badgeBg: "#FBF1DF", badgeFg: "#9a7320" },
  unconfirmed_shifts: { icon: "clock", accent: c.warn, iconBg: "#FBF1DF", badge: "Reminder", badgeBg: "#FBF1DF", badgeFg: "#9a7320" },
  cleaner_cancelled: { icon: "user", accent: c.danger, iconBg: "#F8E5E1", badge: "Urgent", badgeBg: "#F8E5E1", badgeFg: "#a8392b" },
  connection_down: { icon: "cloud", accent: c.danger, iconBg: "#F8E5E1", badge: "Connection", badgeBg: "#F8E5E1", badgeFg: "#a8392b" },
};

export function Alerts() {
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [drawer, setDrawer] = useState<Shift | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});

  async function load() {
    const [a, s] = await Promise.all([getAlerts(), getShifts()]);
    setAlerts(a); setShifts(s); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Optimistic confirm from an alert: mark it actioned + the shift confirmed
  // locally so the row updates instantly, no full refetch.
  async function confirmFromAlert(alertId: string, shiftId: string) {
    setConfirming((c) => ({ ...c, [alertId]: true }));
    const { error } = await confirmShifts([shiftId]);
    setConfirming((c) => ({ ...c, [alertId]: false }));
    if (error) return;
    setAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, status: "actioned" } : a));
    setShifts((prev) => prev.map((s) => s.id === shiftId ? { ...s, status: "confirmed" } : s));
  }

  const shiftFor = (a: Alert) => (a.shift_id ? shifts.find((s) => s.id === a.shift_id) ?? null : null);

  const open = useMemo(() => alerts.filter((a) => a.status === "open"), [alerts]);
  const resolved = useMemo(() => alerts.filter((a) => a.status !== "open"), [alerts]);

  const shownOpen = useMemo(() => open.filter((a) => {
    if (filter === "all") return true;
    if (filter === "understaffed_urgent") return a.alert_type === "understaffed_urgent";
    if (filter === "booking_cancelled") return a.alert_type === "booking_cancelled";
    if (filter === "venue_gap") return a.alert_type === "venue_gap";
    if (filter === "reminders") return a.alert_type === "unconfirmed_shifts" || a.alert_type === "cleaner_cancelled";
    return true;
  }), [open, filter]);

  const chips: [string, string][] = [
    ["all", "All"], ["understaffed_urgent", "Urgent"], ["booking_cancelled", "Cancellation reviews"], ["venue_gap", "Venue gaps"], ["reminders", "Reminders"], ["resolved", "Resolved"],
  ];

  const todayLabel = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long" });

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Alerts" subtitle={`${open.length} open`}
        right={canEdit ? (
          <button onClick={async () => { await Promise.all(open.map((a) => dismissAlert(a.id))); await load(); }}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "6px 11px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
            <Icon name="check" size={14} strokeWidth={1.7} /> Mark all read
          </button>
        ) : undefined} />

      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", gap: 7, padding: "10px 24px" }}>
        {chips.map(([k, l]) => {
          const on = filter === k;
          return (
            <span key={k} onClick={() => setFilter(k)} style={{ background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>
              {l}{k === "all" ? <span style={{ opacity: 0.8 }}> {open.length}</span> : k === "resolved" ? <span style={{ opacity: 0.8 }}> {resolved.length}</span> : null}
            </span>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px 40px" }}>
        {filter !== "resolved" && (<>
        <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 12 }}>Today · {todayLabel}</div>
        {shownOpen.length === 0 && <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: 34, textAlign: "center", color: c.faint, fontSize: 13, marginBottom: 24 }}>No open alerts here.</div>}
        {shownOpen.map((a) => {
          const m = META[a.alert_type];
          const shift = shiftFor(a);
          return (
            <div key={a.id} onClick={() => shift && setDrawer(shift)} style={{ background: "#fff", border: `1px solid ${c.border}`, borderLeft: `3px solid ${m.accent}`, borderRadius: 8, padding: "16px 18px", marginBottom: 12, cursor: shift ? "pointer" : "default" }}>
              <div style={{ display: "flex", gap: 13 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: m.iconBg, color: m.accent, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Icon name={m.icon} size={18} strokeWidth={1.8} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</span>
                    <span style={{ background: m.badgeBg, color: m.badgeFg, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>{m.badge}</span>
                  </div>
                  {a.body && <div style={{ fontSize: 13, color: "#5d665f", marginTop: 4, lineHeight: 1.5 }}>{a.body}</div>}
                  {canEdit && (
                    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12 }}>
                      {a.alert_type === "booking_cancelled" ? (
                        <>
                          <button onClick={async () => { await confirmCancellation(a.id); await load(); }} style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Confirm cancellation</button>
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Take no action</button>
                        </>
                      ) : a.alert_type === "venue_gap" ? (
                        <>
                          <button onClick={() => navigate("/shifts")} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Schedule a cleaning shift</button>
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                        </>
                      ) : a.alert_type === "understaffed_urgent" || a.alert_type === "cleaner_cancelled" ? (
                        <>
                          <button onClick={() => shift ? setAssign(shift) : navigate("/shifts")} style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Assign manually</button>
                          {shift && <button onClick={() => setDrawer(shift)} style={{ background: "none", border: "none", color: c.green, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>View shift →</button>}
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                        </>
                      ) : a.alert_type === "connection_down" ? (
                        <>
                          <button onClick={() => navigate("/connections")} style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Reconnect</button>
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                        </>
                      ) : (
                        <>
                          {shift?.status === "pending_confirmation" && (
                            <button disabled={confirming[a.id]} onClick={() => confirmFromAlert(a.id, shift.id)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: confirming[a.id] ? "wait" : "pointer", opacity: confirming[a.id] ? 0.7 : 1 }}>
                              {confirming[a.id] ? <Spin size={13} color="#fff" /> : <Icon name="check" size={13} strokeWidth={2.4} />} Confirm shift
                            </button>
                          )}
                          {shift && <button onClick={() => setDrawer(shift)} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>View shift</button>}
                          <button onClick={async () => { await dismissAlert(a.id); await load(); }} style={{ background: "none", border: "none", color: c.muted2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Dismiss</button>
                        </>
                      )}
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: c.faint }}>{timeLabel(a.created_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </>)}

        {filter === "resolved" && (
          <>
            {resolved.length === 0 && <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No resolved alerts.</div>}
            {resolved.length > 0 && <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, margin: "0 0 12px", fontFamily: font.body }}>Resolved</div>}
            {resolved.length > 0 && <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
              {resolved.map((a, i) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < resolved.length - 1 ? `1px solid ${c.rowBd}` : "none", opacity: 0.78 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.greenMid, flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</span>
                    <span style={{ fontSize: 12, color: c.faint, marginLeft: 8 }}>{a.status === "actioned" ? "Actioned" : "Dismissed"}</span>
                  </div>
                  <span style={{ fontSize: 11, color: c.faint, flex: "none" }}>{timeLabel(a.created_at)}</span>
                </div>
              ))}
            </div>}
          </>
        )}
      </div>
      {drawer && <ShiftDrawer shift={drawer} onClose={() => setDrawer(null)} onChanged={load} onAssign={(s) => { setDrawer(null); setAssign(s); }} />}
      {assign && <AssignModal shift={assign} onClose={() => setAssign(null)} onAssigned={load} />}
    </div>
  );
}

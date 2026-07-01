import { useEffect, useState } from "react";
import { c, font, TIER_LABEL } from "../theme";
import { Avatar } from "./ui";
import { Icon } from "./Icon";
import { EditShiftModal } from "./EditShiftModal";
import { dateLabel, statusOf, typeLabel } from "../lib/format";
import { deleteShift, getAssignmentsForShift, getCleaners, getStaffing, updateShift } from "../lib/api";
import { toastError } from "../lib/toast";
import type { Cleaner, Shift, ShiftAssignment, ShiftStaffing } from "../lib/types";
import { useAuth } from "../auth/AuthProvider";

const ASSIGN_STATUS: Record<string, { label: string; color: string }> = {
  accepted: { label: "Accepted", color: "#2c6446" },
  offered: { label: "Offered", color: "#9a7320" },
  declined: { label: "Declined", color: "#a8392b" },
  cancelled: { label: "Cancelled", color: "#a39d91" },
  no_response: { label: "No response", color: "#a39d91" },
};

export function ShiftDrawer({ shift, onClose, onChanged, onAssign }: {
  shift: Shift; onClose: () => void; onChanged: () => void; onAssign: (s: Shift) => void;
}) {
  const { canEdit } = useAuth();
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [cleaners, setCleaners] = useState<Record<string, Cleaner>>({});
  const [st, setSt] = useState<ShiftStaffing | undefined>();
  const [showEdit, setShowEdit] = useState(false);

  async function load() {
    const [a, cs, staffing] = await Promise.all([
      getAssignmentsForShift(shift.id), getCleaners(), getStaffing(),
    ]);
    setAssignments(a);
    setCleaners(Object.fromEntries(cs.map((x) => [x.id, x])));
    setSt(staffing[shift.id]);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [shift.id]);

  const status = statusOf(shift);
  const accepted = st?.accepted_count ?? 0;
  const offered = st?.offered_count ?? 0;
  const open = Math.max(shift.required_cleaners - accepted - offered, 0);
  const time = shift.start_time.slice(0, 5);
  const tierBadge = shift.status === "staffing" && shift.current_tier ? `${status.label} · ${TIER_LABEL[shift.current_tier]}` : status.label;

  const segments: string[] = [];
  for (let i = 0; i < accepted; i++) segments.push("#3D8B5F");
  for (let i = 0; i < offered; i++) segments.push("#aacfb8");
  for (let i = 0; i < open; i++) segments.push("#e0dccf");

  const tiersWithOffers = new Set(assignments.map((a) => a.tier_at_offer));
  const order = ["tier_1", "tier_2", "tier_3"] as const;
  const currentIdx = shift.current_tier ? order.indexOf(shift.current_tier) : -1;

  const responders = assignments
    .map((a) => ({ a, cl: cleaners[a.cleaner_id] }))
    .filter((r) => r.cl && r.a.status !== "no_response");

  async function cancelShift() {
    if (!confirm("Cancel this shift?")) return;
    await updateShift(shift.id, { status: "cancelled", cancelled_at: new Date().toISOString() });
    onChanged(); onClose();
  }

  async function removeShift() {
    if (!confirm("Permanently delete this shift? This cannot be undone.")) return;
    const err = await deleteShift(shift.id);
    if (err) { toastError(err); return; }
    onChanged(); onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,25,.34)", zIndex: 55, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", height: "100%", background: c.sand, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px -12px rgba(20,30,25,.28)" }}>
        {/* header */}
        <div style={{ flex: "none", padding: "18px 22px 16px", borderBottom: `1px solid ${c.border}`, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: status.bg, color: status.fg, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: status.dot }} />{tierBadge}
                </span>
                <span style={{ background: shift.source === "manual" ? "#e7f0ed" : "#f0eee9", color: shift.source === "manual" ? "#21564b" : "#6b665c", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5 }}>{shift.source === "manual" ? "Manual" : "Auto"}</span>
              </div>
              <h2 style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>{typeLabel(shift)}</h2>
              <div style={{ fontSize: 12.5, color: c.muted2 }}>{typeLabel(shift)} · {dateLabel(shift.shift_date)}, {time} · {shift.estimated_hours} hrs</div>
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, flex: "none", border: `1px solid ${c.border}`, background: "#fff", borderRadius: 6, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} strokeWidth={1.8} /></button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 22px 24px" }}>
          {/* staffing bar */}
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "15px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
              <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Required vs assigned</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{accepted} / {shift.required_cleaners} {offered > 0 && <span style={{ color: c.faint, fontWeight: 400 }}>· {offered} offered</span>}</span>
            </div>
            <div style={{ display: "flex", gap: 3, marginBottom: 9 }}>
              {segments.map((s, i) => <span key={i} style={{ height: 7, flex: 1, borderRadius: 3, background: s }} />)}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: c.muted2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#3D8B5F" }} />Accepted {accepted}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#aacfb8" }} />Offered {offered}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#e0dccf" }} />Open {open}</span>
            </div>
          </div>

          {/* escalation timeline */}
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 12 }}>Escalation timeline</div>
          <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 22, padding: "0 4px" }}>
            {order.map((t, i) => {
              const done = currentIdx >= 0 ? i < currentIdx : tiersWithOffers.has(t);
              const active = i === currentIdx;
              const node = done && !active
                ? <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#3D8B5F", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}><Icon name="check" size={14} strokeWidth={2.6} /></div>
                : active
                  ? <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", fontSize: 11, fontWeight: 700, boxShadow: "0 0 0 4px #dceae7" }}>{i + 1}</div>
                  : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#fff", border: `1.5px solid ${c.border3}`, color: c.faint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", fontSize: 11, fontWeight: 700 }}>{i + 1}</div>;
              const subColor = active ? "#256058" : done ? c.faint : c.faint;
              return (
                <div key={t} style={{ display: "contents" }}>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    {node}
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, color: active ? "#256058" : done ? c.ink : c.muted2 }}>{TIER_LABEL[t]}</div>
                    <div style={{ fontSize: 10, color: subColor }}>{active ? "Active now" : done ? "Offered" : "Not reached"}</div>
                  </div>
                  {i < 2 && <div style={{ flex: "none", width: 30, height: 2, background: i < currentIdx ? c.teal : c.border3, marginTop: 12 }} />}
                </div>
              );
            })}
          </div>

          {/* responders */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Cleaner responses</span>
            {canEdit && <button onClick={() => onAssign(shift)} style={{ background: "none", border: "none", fontSize: 12, fontWeight: 600, color: c.green, cursor: "pointer" }}>Override →</button>}
          </div>
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
            {responders.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: c.faint, textAlign: "center" }}>No offers yet.</div>}
            {responders.map(({ a, cl }, i) => {
              const stat = ASSIGN_STATUS[a.status];
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderBottom: i < responders.length - 1 ? `1px solid ${c.rowBd}` : "none" }}>
                  <Avatar name={cl!.full_name} size={28} bg={cl!.is_team_leader ? c.green : c.greenMid} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {cl!.full_name}
                      {cl!.is_team_leader
                        ? <span style={{ fontSize: 10, color: "#9a7320", background: "#FBF1DF", padding: "0 6px", borderRadius: 4, fontWeight: 600, marginLeft: 6 }}>Team Lead</span>
                        : <span style={{ fontSize: 10, color: c.muted2, marginLeft: 6 }}>{TIER_LABEL[a.tier_at_offer]}</span>}
                    </div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: stat.color, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: stat.color }} />{stat.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {canEdit && shift.status !== "cancelled" && (
          <div style={{ flex: "none", padding: "14px 22px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 9 }}>
            <button onClick={() => setShowEdit(true)} style={{ flex: 1, background: c.green, color: "#fff", border: "none", borderRadius: 7, padding: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Edit shift</button>
            <button onClick={() => onAssign(shift)} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 7, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Override</button>
            <button onClick={cancelShift} style={{ background: "#fff", color: "#a8392b", border: "1px solid #e5c6c0", borderRadius: 7, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={removeShift} title="Delete shift" style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 7, padding: "10px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center" }}><Icon name="trash" size={15} strokeWidth={2} /></button>
          </div>
        )}
      </div>

      {showEdit && <EditShiftModal shift={shift} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); onChanged(); }} />}
    </div>
  );
}

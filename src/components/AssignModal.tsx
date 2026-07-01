import { useEffect, useState } from "react";
import { Avatar } from "./ui";
import { Icon } from "./Icon";
import { getAssignmentsForShift, getCleaners, getStaffing, manualAssign } from "../lib/api";
import { toastError } from "../lib/toast";
import { c, font, TIER_LABEL } from "../theme";
import { typeLabel } from "../lib/format";
import type { Cleaner, Shift } from "../lib/types";

export function AssignModal({ shift, onClose, onAssigned }: {
  shift: Shift; onClose: () => void; onAssigned: () => void;
}) {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [openSlots, setOpenSlots] = useState(shift.required_cleaners);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [cs, a, staffing] = await Promise.all([
      getCleaners(), getAssignmentsForShift(shift.id), getStaffing(),
    ]);
    setCleaners(cs.filter((x) => x.is_active));
    setAssignedIds(new Set(a.filter((x) => x.status === "accepted").map((x) => x.cleaner_id)));
    const st = staffing[shift.id];
    setOpenSlots(Math.max(shift.required_cleaners - (st?.accepted_count ?? 0), 0));
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [shift.id]);

  async function assign(cleanerId: string) {
    setBusyId(cleanerId);
    const { error } = await manualAssign(shift.id, cleanerId);
    setBusyId(null);
    if (error) { toastError(error); return; }
    await load();
    onAssigned();
  }

  const avBg = (cl: Cleaner) => cl.is_team_leader ? c.green : cl.tier === "tier_1" ? c.greenMid : cl.tier === "tier_2" ? c.warn : c.teal;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,22,.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: "88vh", background: c.sand, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header */}
        <div style={{ flex: "none", padding: "18px 22px 14px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: c.sand }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F8E5E1", color: "#a8392b", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.danger }} />Urgent · {shift.current_tier ? TIER_LABEL[shift.current_tier] : "Tier 3"}
            </div>
            <h2 style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, margin: "0 0 3px" }}>Assign manually</h2>
            <div style={{ fontSize: 12.5, color: c.muted2 }}>{typeLabel(shift)} · <span style={{ color: c.danger, fontWeight: 600 }}>{openSlots} spot(s) still open</span></div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={15} strokeWidth={2} /></button>
        </div>

        {/* slots bar */}
        <div style={{ flex: "none", padding: "12px 22px", background: "#fff", borderBottom: `1px solid ${c.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Spots to fill</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#a8392b" }}>{openSlots} / {shift.required_cleaners} open</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: shift.required_cleaners }).map((_, i) => (
              <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < shift.required_cleaners - openSlots ? "#3D8B5F" : "#e6c3bc" }} />
            ))}
          </div>
        </div>

        {/* cleaner list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 20px" }}>
          {(["tier_1", "tier_2", "tier_3"] as const).map((t) => {
            const inTier = cleaners.filter((cl) => cl.tier === t && !assignedIds.has(cl.id));
            if (!inTier.length) return null;
            return (
              <div key={t} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Available · {TIER_LABEL[t]}</div>
                <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {inTier.map((cl, i) => (
                    <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < inTier.length - 1 ? `1px solid ${c.rowBd}` : "none" }}>
                      <Avatar name={cl.full_name} size={36} bg={avBg(cl)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{cl.full_name}</div>
                        <div style={{ fontSize: 11.5, color: c.muted2, marginTop: 1 }}>{TIER_LABEL[cl.tier]} · {cl.phone}</div>
                      </div>
                      <button onClick={() => assign(cl.id)} disabled={busyId === cl.id} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busyId === cl.id ? 0.6 : 1 }}>{busyId === cl.id ? "…" : "Assign"}</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ flex: "none", padding: "14px 22px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, color: c.faint }}>Cleaners will receive an immediate notification.</span>
          <button onClick={onClose} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Avatar, ConfirmDialog } from "./ui";
import { Icon } from "./Icon";
import { ASSIGN_STATUS } from "./ShiftDrawer";
import { getAssignmentsForShift, getCleaners, getStaffing, manualAssign } from "../lib/api";
import { toastError } from "../lib/toast";
import { c, font, TIER_LABEL } from "../theme";
import { dateLabel, typeLabel } from "../lib/format";
import type { Cleaner, Shift } from "../lib/types";

export function AssignModal({ shift, onClose, onAssigned }: {
  shift: Shift; onClose: () => void; onAssigned: () => void;
}) {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  // Cleaners already sent an offer (status "offered") for this shift — keep them
  // visible but with a disabled "Offered" button so they can't be re-offered.
  const [offeredIds, setOfferedIds] = useState<Set<string>>(new Set());
  // Cleaners who declined this shift's offer — kept visible with a LIVE "Re-offer"
  // button (the offerToCleaner upsert resets their declined row to offered).
  const [declinedIds, setDeclinedIds] = useState<Set<string>>(new Set());
  // Two-step guard before an offer goes out — sending a WhatsApp to a person.
  const [pendingOffer, setPendingOffer] = useState<Cleaner | null>(null);
  const [openSlots, setOpenSlots] = useState(shift.required_cleaners);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const [cs, a, staffing] = await Promise.all([
      getCleaners(), getAssignmentsForShift(shift.id), getStaffing(),
    ]);
    // The Cleaning Manager (is_team_leader) is above-tier and normally auto-rostered,
    // never offered — keep her out. EXCEPTION: a wipeover has no auto-roster slot, so
    // there she is a working cleaner who can be manually offered — include her only then.
    const isWipeover = shift.shift_type === "wipeover";
    setCleaners(cs.filter((x) => x.is_active && (!x.is_team_leader || isWipeover)));
    setAssignedIds(new Set(
      a.filter((x) => x.status === "accepted" || x.status === "team_lead").map((x) => x.cleaner_id),
    ));
    setOfferedIds(new Set(a.filter((x) => x.status === "offered").map((x) => x.cleaner_id)));
    setDeclinedIds(new Set(a.filter((x) => x.status === "declined").map((x) => x.cleaner_id)));
    const st = staffing[shift.id];
    setOpenSlots(Math.max(shift.required_cleaners - (st?.accepted_count ?? 0), 0));
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [shift.id]);

  async function assign(cleanerId: string) {
    setBusyId(cleanerId);
    const { error } = await manualAssign(shift.id, cleanerId);
    setBusyId(null);
    if (error) { toastError(error); return; }
    // Reflect the sent offer immediately so the button locks even before reload.
    setOfferedIds((prev) => new Set(prev).add(cleanerId));
    await load();
    onAssigned();
  }

  const avBg = (cl: Cleaner) => cl.is_team_leader ? c.green : cl.tier === "tier_1" ? c.greenMid : cl.tier === "tier_2" ? c.warn : c.teal;

  // One cleaner row — shared by the tier groups and the wipeover Cleaning Manager
  // section so both render identically. isLast controls the divider (a single-row
  // section passes true → no trailing border).
  const renderRow = (cl: Cleaner, isLast: boolean) => {
    const offered = offeredIds.has(cl.id);
    const declined = declinedIds.has(cl.id);
    const busy = busyId === cl.id;
    const subLabel = cl.is_team_leader ? "Cleaning Manager" : TIER_LABEL[cl.tier];
    return (
      <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: isLast ? "none" : `1px solid ${c.rowBd}` }}>
        <Avatar name={cl.full_name} size={36} bg={avBg(cl)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{cl.full_name}</div>
          <div style={{ fontSize: 11.5, color: c.muted2, marginTop: 1 }}>{subLabel} · {cl.phone}</div>
        </div>
        {declined && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: ASSIGN_STATUS.declined.color, border: `1px solid ${ASSIGN_STATUS.declined.color}`, borderRadius: 5, padding: "1px 7px" }}>
            {ASSIGN_STATUS.declined.label}
          </span>
        )}
        <button
          onClick={() => setPendingOffer(cl)}
          disabled={busy || offered}
          style={{
            background: offered ? "#eef2ee" : c.green,
            color: offered ? c.muted2 : "#fff",
            border: offered ? `1px solid ${c.border}` : "none",
            borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600,
            cursor: busy || offered ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "…" : offered ? "Offered ✓" : declined ? "Re-offer" : "Offer"}
        </button>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,22,.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: "88vh", background: c.sand, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header */}
        <div style={{ flex: "none", padding: "18px 22px 14px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: c.sand }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F8E5E1", color: "#a8392b", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.danger }} />Urgent · {shift.current_tier ? TIER_LABEL[shift.current_tier] : "Tier 3"}
            </div>
            <h2 style={{ fontFamily: font.display, fontSize: 20, fontWeight: font.displayWeight, margin: "0 0 3px" }}>Assign manually</h2>
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
          {/* Cleaning Manager — wipeover only. She's above-tier (no Tier bucket), so
              she gets her own section at the top, matching the drawer's label. */}
          {shift.shift_type === "wipeover" && (() => {
            const mgr = cleaners.find((cl) => cl.is_team_leader && !assignedIds.has(cl.id));
            if (!mgr) return null;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Cleaning Manager</div>
                <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {renderRow(mgr, true)}
                </div>
              </div>
            );
          })()}
          {(["tier_1", "tier_2", "tier_3"] as const).map((t) => {
            const inTier = cleaners.filter((cl) => cl.tier === t && !cl.is_team_leader && !assignedIds.has(cl.id));
            if (!inTier.length) return null;
            return (
              <div key={t} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Available · {TIER_LABEL[t]}</div>
                <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {inTier.map((cl, i) => renderRow(cl, i === inTier.length - 1))}
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
      {pendingOffer && (
        <ConfirmDialog
          title={declinedIds.has(pendingOffer.id) ? "Re-offer shift" : "Send shift offer"}
          message={<>Send a WhatsApp offer to <b>{pendingOffer.full_name}</b> for the {typeLabel(shift)} on {dateLabel(shift.shift_date)}? They'll get an Accept/Decline message.</>}
          confirmLabel={declinedIds.has(pendingOffer.id) ? "Re-offer" : "Send offer"}
          busy={busyId === pendingOffer.id}
          onConfirm={() => { const id = pendingOffer.id; setPendingOffer(null); assign(id); }}
          onCancel={() => setPendingOffer(null)}
        />
      )}
    </div>
  );
}

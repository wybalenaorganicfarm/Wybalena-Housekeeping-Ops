import { useEffect, useState } from "react";
import { c, font, TIER_LABEL } from "../theme";
import { Avatar, ConfirmDialog, Spin } from "./ui";
import { Icon } from "./Icon";
import { EditShiftModal } from "./EditShiftModal";
import { dateLabel, dateTimeLabel, statusOf, typeLabel } from "../lib/format";
import { confirmShifts, deleteShift, getAssignmentsForShift, getCleaners, getProfileNames, getShift, getStaffing, getTeamLead, updateShift } from "../lib/api";
import { toastError } from "../lib/toast";
import type { Booking, Cleaner, Shift, ShiftAssignment, ShiftStaffing } from "../lib/types";
import { useAuth } from "../auth/AuthProvider";

const ASSIGN_STATUS: Record<string, { label: string; color: string }> = {
  team_lead: { label: "Team Lead", color: c.lead },
  accepted: { label: "Accepted", color: "#2c6446" },
  offered: { label: "Offered", color: "#9a7320" },
  declined: { label: "Declined", color: "#a8392b" },
  cancelled: { label: "Cancelled", color: "#a39d91" },
  no_response: { label: "No response", color: "#a39d91" },
};

export function ShiftDrawer({ shift, booking, onClose, onChanged, onAssign, onViewBooking }: {
  shift: Shift; booking?: Booking; onClose: () => void; onChanged: () => void; onAssign: (s: Shift) => void; onViewBooking?: (b: Booking) => void;
}) {
  const { canEdit } = useAuth();
  // Local, refreshable copy of the shift — the prop is a snapshot from the list
  // and would otherwise show stale data (e.g. edited special instructions) until
  // the drawer is reopened.
  const [s, setS] = useState<Shift>(shift);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [cleaners, setCleaners] = useState<Record<string, Cleaner>>({});
  const [st, setSt] = useState<ShiftStaffing | undefined>();
  const [teamLead, setTeamLead] = useState<{ id: string; full_name: string } | null>(null);
  const [instrAuthor, setInstrAuthor] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  async function load() {
    const [fresh, a, cs, staffing, lead] = await Promise.all([
      getShift(shift.id), getAssignmentsForShift(shift.id), getCleaners(), getStaffing(), getTeamLead(),
    ]);
    if (fresh) setS(fresh);
    setAssignments(a);
    setCleaners(Object.fromEntries(cs.map((x) => [x.id, x])));
    setSt(staffing[shift.id]);
    setTeamLead(lead);
    const authorId = fresh?.special_instructions_by;
    setInstrAuthor(authorId ? (await getProfileNames([authorId]))[authorId] ?? null : null);
  }
  useEffect(() => { setS(shift); load(); /* eslint-disable-line */ }, [shift.id]);

  const status = statusOf(s);
  const lead = st?.lead_count ?? 0;
  const accepted = st?.accepted_count ?? 0;
  const offered = st?.offered_count ?? 0;
  const open = Math.max(s.required_cleaners - accepted - offered, 0);
  const time = s.start_time.slice(0, 5);
  const tierBadge = s.status === "staffing" && s.current_tier ? `${status.label} · ${TIER_LABEL[s.current_tier]}` : status.label;

  const segments: string[] = [];
  for (let i = 0; i < lead; i++) segments.push(c.lead);
  for (let i = 0; i < accepted; i++) segments.push("#3D8B5F");
  for (let i = 0; i < offered; i++) segments.push("#aacfb8");
  for (let i = 0; i < open; i++) segments.push("#e0dccf");

  const tiersWithOffers = new Set(assignments.map((a) => a.tier_at_offer));
  const order = ["tier_1", "tier_2", "tier_3"] as const;
  const currentIdx = s.current_tier ? order.indexOf(s.current_tier) : -1;

  type ResponderRow = { key: string; name: string; statusKey: string; tierLabel: string | null; isLead: boolean };
  const cleanerRows: ResponderRow[] = assignments
    .map((a) => ({ a, cl: cleaners[a.cleaner_id] }))
    .filter((r) => r.cl && r.a.status !== "no_response")
    .map(({ a, cl }) => ({ key: a.id, name: cl!.full_name, statusKey: a.status, tierLabel: TIER_LABEL[a.tier_at_offer], isLead: false }));
  // The team lead (a profiles row, not a cleaner) is auto-assigned to every shift
  // — inject them at the top with a "Team Lead" status.
  const responders: ResponderRow[] = teamLead
    ? [{ key: "team-lead", name: teamLead.full_name, statusKey: "team_lead", tierLabel: null, isLead: true }, ...cleanerRows]
    : cleanerRows;

  const [confirming, setConfirming] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function confirmShift() {
    setConfirming(true);
    const { error } = await confirmShifts([shift.id]);
    setConfirming(false);
    if (error) { toastError(error); return; }
    onChanged(); onClose();
  }

  async function cancelShift() {
    setCancelling(true);
    const err = await updateShift(shift.id, { status: "cancelled", cancelled_at: new Date().toISOString() });
    setCancelling(false);
    setAskCancel(false);
    if (err) { toastError(err); return; }
    onChanged(); onClose();
  }

  async function removeShift() {
    setDeleting(true);
    const err = await deleteShift(shift.id);
    setDeleting(false);
    setAskDelete(false);
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
                <span style={{ background: s.source === "manual" ? "#e7f0ed" : "#f0eee9", color: s.source === "manual" ? "#21564b" : "#6b665c", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5 }}>{s.source === "manual" ? "Manual" : "Auto"}</span>
              </div>
              <h2 style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>{typeLabel(s)}</h2>
              <div style={{ fontSize: 12.5, color: c.muted2 }}>{typeLabel(s)} · {dateLabel(s.shift_date)}, {time} · {s.estimated_hours} hrs</div>
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, flex: "none", border: `1px solid ${c.border}`, background: "#fff", borderRadius: 6, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} strokeWidth={1.8} /></button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 22px 24px" }}>
          {/* staffing bar */}
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "15px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
              <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Required vs assigned</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{lead > 0 && <span style={{ color: c.lead }}>{lead} + </span>}{accepted} / {s.required_cleaners} {offered > 0 && <span style={{ color: c.faint, fontWeight: 400 }}>· {offered} offered</span>}</span>
            </div>
            <div style={{ display: "flex", gap: 3, marginBottom: 9 }}>
              {segments.map((seg, i) => <span key={i} style={{ height: 7, flex: 1, borderRadius: 3, background: seg }} />)}
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: c.muted2, flexWrap: "wrap" }}>
              {lead > 0 && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c.lead }} />Team Lead {lead}</span>}
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#3D8B5F" }} />Accepted {accepted}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#aacfb8" }} />Offered {offered}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#e0dccf" }} />Open {open}</span>
            </div>
          </div>

          {/* linked booking */}
          {booking && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Booking</div>
              <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: onViewBooking ? 10 : 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{booking.guest_name || "Unnamed booking"}</div>
                    <div style={{ fontSize: 12, color: c.muted2, marginTop: 2 }}>{dateTimeLabel(booking.check_in)} → {dateTimeLabel(booking.check_out)}</div>
                  </div>
                  <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: booking.is_cancelled ? "#a8392b" : "#2c6446" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: booking.is_cancelled ? c.danger : c.greenMid }} />{booking.is_cancelled ? "Cancelled" : "Confirmed"}
                  </span>
                </div>
                {onViewBooking && (
                  <button onClick={() => onViewBooking(booking)} style={{ width: "100%", background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 7, padding: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                    View booking for this shift <Icon name="chevronRight" size={14} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* special instructions */}
          {s.special_instructions && (
            <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "13px 16px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Icon name="note" size={13} strokeWidth={2} color={c.muted2} />
                <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Special instructions</span>
              </div>
              <div style={{ fontSize: 13, color: c.body, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{s.special_instructions}</div>
              {(instrAuthor || s.special_instructions_at) && (
                <div style={{ fontSize: 11, color: c.faint, marginTop: 8 }}>
                  {instrAuthor ? `Added by ${instrAuthor}` : "Added"}{s.special_instructions_at ? ` · ${new Date(s.special_instructions_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                </div>
              )}
            </div>
          )}

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
            {canEdit && <button onClick={() => onAssign(s)} style={{ background: "none", border: "none", fontSize: 12, fontWeight: 600, color: c.green, cursor: "pointer" }}>Override →</button>}
          </div>
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
            {responders.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: c.faint, textAlign: "center" }}>No offers yet.</div>}
            {responders.map((r, i) => {
              const stat = ASSIGN_STATUS[r.statusKey] ?? ASSIGN_STATUS.offered;
              return (
                <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderBottom: i < responders.length - 1 ? `1px solid ${c.rowBd}` : "none" }}>
                  <Avatar name={r.name} size={28} bg={r.isLead ? c.lead : c.greenMid} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {r.name}
                      {r.tierLabel && <span style={{ fontSize: 10, color: c.muted2, marginLeft: 6 }}>{r.tierLabel}</span>}
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

        {canEdit && s.status !== "cancelled" && (
          <div style={{ flex: "none", padding: "14px 22px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 9 }}>
            {s.status === "pending_confirmation" && (
              <button onClick={confirmShift} disabled={confirming} style={{ flex: 1, background: c.green, color: "#fff", border: "none", borderRadius: 7, padding: 10, fontSize: 13, fontWeight: 600, cursor: confirming ? "wait" : "pointer", opacity: confirming ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {confirming ? <Spin size={15} color="#fff" /> : <Icon name="check" size={15} strokeWidth={2.4} />} {confirming ? "Confirming…" : "Confirm shift"}
              </button>
            )}
            <button onClick={() => setShowEdit(true)} style={{ flex: 1, background: s.status === "pending_confirmation" ? "#fff" : c.green, color: s.status === "pending_confirmation" ? c.body : "#fff", border: s.status === "pending_confirmation" ? `1px solid ${c.border3}` : "none", borderRadius: 7, padding: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Edit shift</button>
            <button onClick={() => onAssign(s)} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 7, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Override</button>
            <button onClick={() => setAskCancel(true)} style={{ background: "#fff", color: "#a8392b", border: "1px solid #e5c6c0", borderRadius: 7, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={() => setAskDelete(true)} title="Delete shift" style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 7, padding: "10px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center" }}><Icon name="trash" size={15} strokeWidth={2} /></button>
          </div>
        )}
      </div>

      {showEdit && <EditShiftModal shift={s} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load(); onChanged(); }} />}
      {askCancel && (
        <ConfirmDialog
          title="Cancel shift"
          message="Cancel this shift? It will be marked cancelled and no longer offered to cleaners."
          confirmLabel="Cancel shift" cancelLabel="Keep shift" danger busy={cancelling}
          onConfirm={cancelShift} onCancel={() => setAskCancel(false)}
        />
      )}
      {askDelete && (
        <ConfirmDialog
          title="Delete shift"
          message="Permanently delete this shift? This cannot be undone."
          confirmLabel="Delete" danger busy={deleting}
          onConfirm={removeShift} onCancel={() => setAskDelete(false)}
        />
      )}
    </div>
  );
}

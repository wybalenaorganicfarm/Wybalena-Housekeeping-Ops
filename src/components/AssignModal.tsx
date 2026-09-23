import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Avatar, ConfirmDialog } from "./ui";
import { Icon } from "./Icon";
import { ASSIGN_STATUS } from "./ShiftDrawer";
import {
  addAccepted, cancelAccepted, getAssignmentsForShift, getCleaners, getStaffing,
  manualAssign, withdrawOffer,
} from "../lib/api";
import { toastError } from "../lib/toast";
import { c, font, TIER_LABEL } from "../theme";
import { dateLabel, typeLabel } from "../lib/format";
import type { Cleaner, Shift, ShiftAssignment } from "../lib/types";

// Fixed column widths for the cleaner rows, so status and actions line up
// vertically down the list rather than tracking each name's length.
//   STATUS_COL fits the longest label, "Cleaning Manager", plus its dot.
//   ACTION_COL fits the widest pair, "Add anyway" + the "Re-offer" button.
const STATUS_COL = 116;
const ACTION_COL = 168;

// The per-cleaner action the admin is about to take — drives the one shared
// ConfirmDialog. `kind` picks the message + which endpoint fires on confirm.
// withdraw/cancel need the assignment id; offer/reoffer/add work off the cleaner.
type PendingAction =
  | { kind: "offer" | "reoffer" | "add"; cleaner: Cleaner }
  | { kind: "withdraw" | "cancel"; cleaner: Cleaner; assignmentId: string };

export function AssignModal({ shift, onClose, onAssigned }: {
  shift: Shift; onClose: () => void; onAssigned: () => void;
}) {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  // Every assignment row for this shift, keyed by cleaner_id — the single source
  // of per-cleaner state (status + assignment id) each row's actions read from.
  // Replaces the old offered/declined/assigned id Sets, which couldn't carry the
  // assignment id or the full status the withdraw/cancel/re-offer actions need.
  const [byCleaner, setByCleaner] = useState<Map<string, ShiftAssignment>>(new Map());
  // Two-step guard before any state change that messages a person or removes them.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [openSlots, setOpenSlots] = useState(shift.required_cleaners);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The Cleaning Manager (is_team_leader) is above-tier: on a wipeover she is a
  // working cleaner who can be assigned like anyone else, and on every other
  // shift she is auto-rostered (status 'team_lead') as a notification that fills
  // no slot. She is listed EITHER WAY — she was previously filtered out entirely
  // on non-wipeover shifts, which left admins unable to see her roster row or
  // add her to an ordinary shift by hand. Her row renders read-only when it is
  // an auto-roster reservation (see `isLeadRow` in renderRow), so showing her
  // here cannot accidentally offer her a shift or inflate the staffing count.
  const isWipeover = shift.shift_type === "wipeover";

  async function load() {
    const [cs, a, staffing] = await Promise.all([
      getCleaners(), getAssignmentsForShift(shift.id), getStaffing(),
    ]);
    setCleaners(cs.filter((x) => x.is_active));
    setByCleaner(new Map(a.map((x) => [x.cleaner_id, x])));
    const st = staffing[shift.id];
    setOpenSlots(Math.max(shift.required_cleaners - (st?.accepted_count ?? 0), 0));
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [shift.id]);

  // --- Action runners: each mirrors the old assign() shape (busy → call →
  // toast-or-reload). All reload from the server so the row's pill + actions and
  // the slot bar reflect the new state immediately. ------------------------------
  async function runOffer(cleanerId: string) {  // offer + re-offer (manual-assign upsert)
    setBusyId(cleanerId);
    const { error } = await manualAssign(shift.id, cleanerId);
    setBusyId(null);
    if (error) { toastError(error); return; }
    await load(); onAssigned();
  }
  async function runAdd(cleanerId: string) {
    setBusyId(cleanerId);
    const { data, error } = await addAccepted(shift.id, cleanerId);
    setBusyId(null);
    if (error || data?.error) { toastError(error ?? data!.error!); return; }
    await load(); onAssigned();
  }
  async function runWithdraw(assignmentId: string, cleanerId: string) {
    setBusyId(cleanerId);
    const { data, error } = await withdrawOffer(assignmentId);
    setBusyId(null);
    if (error || data?.error) { toastError(error ?? data!.error!); return; }
    await load(); onAssigned();
  }
  async function runCancel(assignmentId: string, cleanerId: string) {
    setBusyId(cleanerId);
    const { data, error } = await cancelAccepted(assignmentId);
    setBusyId(null);
    if (error || data?.error) { toastError(error ?? data!.error!); return; }
    await load(); onAssigned();
  }
  function runPending(p: PendingAction) {
    if (p.kind === "withdraw") runWithdraw(p.assignmentId, p.cleaner.id);
    else if (p.kind === "cancel") runCancel(p.assignmentId, p.cleaner.id);
    else if (p.kind === "add") runAdd(p.cleaner.id);
    else runOffer(p.cleaner.id); // offer | reoffer
  }

  const avBg = (cl: Cleaner) => cl.is_team_leader ? c.green : cl.tier === "tier_1" ? c.greenMid : cl.tier === "tier_2" ? c.warn : c.teal;

  // Shared row-button styles. Compact by design: in a 480px modal a dozen rows of
  // full-size buttons is what made this screen feel cluttered.
  const btn = (bg: string, fg: string, bd: string | null): CSSProperties => ({
    background: bg, color: fg, border: bd ? `1px solid ${bd}` : "none",
    borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    whiteSpace: "nowrap",
  });
  const solid = btn(c.green, "#fff", null);
  const subtle = btn("#fff", c.body, c.border3);
  const danger = btn("#fff", "#a8392b", "#e6c3bc");
  // A secondary action demoted to a quiet text link, so each row has ONE obvious
  // button instead of two competing for attention.
  const link: CSSProperties = {
    background: "none", border: "none", padding: "5px 2px", fontSize: 11.5,
    fontWeight: 600, color: c.muted2, cursor: "pointer", whiteSpace: "nowrap",
  };

  // The buttons for a row, chosen by the cleaner's current assignment status.
  function rowActions(cl: Cleaner, a: ShiftAssignment | undefined, busy: boolean): ReactNode {
    if (busy) return <button disabled style={{ ...subtle, cursor: "default", opacity: 0.6 }}>…</button>;
    // The Cleaning Manager is never OFFERED a non-wipeover shift — she is rostered
    // onto it automatically. Without this, a shift created before she was
    // nominated (the roster trigger fires on INSERT and is not backfilled) has no
    // team_lead row, so the default branch below would show "Offer" / "Add as
    // accepted": the first sends her a tier offer she should never receive, the
    // second consumes one of the shift's cleaner slots. Only a wipeover, where she
    // genuinely works as a cleaner, gets the normal buttons.
    if (cl.is_team_leader && !isWipeover && a?.status !== "accepted") return null;
    switch (a?.status) {
      case "accepted":
        return <button style={danger} onClick={() => setPending({ kind: "cancel", cleaner: cl, assignmentId: a.id })}>Take off shift</button>;
      // In each pair below the PRIMARY action is a button and the secondary one a
      // quiet link. Both are still one click — this only stops every row shouting
      // with two equally-weighted buttons, which is what made the list cluttered.
      case "offered":
      case "send_failed":
        return <>
          <button style={link} onClick={() => setPending({ kind: "withdraw", cleaner: cl, assignmentId: a.id })}>Withdraw</button>
          <button style={subtle} onClick={() => setPending({ kind: "offer", cleaner: cl })}>Resend</button>
        </>;
      case "no_response":
        return <>
          <button style={link} onClick={() => setPending({ kind: "withdraw", cleaner: cl, assignmentId: a.id })}>Withdraw</button>
          <button style={subtle} onClick={() => setPending({ kind: "offer", cleaner: cl })}>Re-offer</button>
        </>;
      case "declined":
      case "cancelled":
        return <>
          <button style={link} onClick={() => setPending({ kind: "add", cleaner: cl })}>Add anyway</button>
          <button style={solid} onClick={() => setPending({ kind: "reoffer", cleaner: cl })}>Re-offer</button>
        </>;
      default: // no row yet — never offered
        return <>
          <button style={link} onClick={() => setPending({ kind: "add", cleaner: cl })}>Add directly</button>
          <button style={solid} onClick={() => setPending({ kind: "offer", cleaner: cl })}>Offer</button>
        </>;
    }
  }

  // One cleaner row — shared by the tier groups and the wipeover Cleaning Manager
  // section so both render identically. isLast controls the divider.
  //
  // THREE ALIGNED COLUMNS: name (flexes) | status (fixed) | actions (fixed).
  // The status and action columns have fixed widths so they line up vertically
  // down the whole list instead of sitting wherever each name happens to end —
  // a ragged right edge was a large part of why this screen read as cluttered.
  //
  // The status itself reuses the ShiftDrawer's exact treatment (6px dot + 11.5px
  // coloured bold label, name and tier inline above) so the same information
  // looks the same on both screens.
  const renderRow = (cl: Cleaner, isLast: boolean) => {
    const a = byCleaner.get(cl.id);
    const status = a?.status;
    const busy = busyId === cl.id;
    const isLeadRow = status === "team_lead";
    const stat = status ? ASSIGN_STATUS[status] : undefined;
    return (
      <div key={cl.id} className="asg-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderBottom: isLast ? "none" : `1px solid ${c.rowBd}` }}>
        <Avatar name={cl.full_name} size={28} bg={avBg(cl)} />
        {/* Name column — tier inline after the name, matching the drawer. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cl.full_name}
            {/* The manager's status column already reads "Cleaning Manager", so
                repeating it here would say the same word twice on one row. */}
            {!cl.is_team_leader && <span style={{ fontSize: 10, color: c.muted2, marginLeft: 6 }}>{TIER_LABEL[cl.tier]}</span>}
          </div>
        </div>
        {/* Status column — fixed width so every dot lines up. */}
        <div className="asg-status" style={{ flex: "none", width: STATUS_COL, minWidth: 0 }}>
          {stat && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: stat.color, fontWeight: 600, whiteSpace: "nowrap" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: stat.color, flex: "none" }} />{stat.label}
            </span>
          )}
        </div>
        {/* Action column — fixed width, right-aligned, so buttons form one line
            down the far right whatever each row's state is. */}
        <div className="asg-actions" style={{ flex: "none", width: ACTION_COL, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
          {!isLeadRow && rowActions(cl, a, busy)}
        </div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,22,.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="asg-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "88vh", background: c.sand, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* The three fixed columns need ~590px. Below that the status drops under
            the name and the action column gives up its fixed width, so nothing is
            clipped on a phone. Scoped to `.asg-modal` — nothing leaks out. */}
        <style>{`
          @media (max-width: 620px) {
            .asg-modal .asg-row { flex-wrap: wrap; row-gap: 6px; }
            .asg-modal .asg-status { width: auto; order: 3; padding-left: 39px; }
            .asg-modal .asg-actions { width: auto; margin-left: auto; }
          }
        `}</style>
        {/* header */}
        <div style={{ flex: "none", padding: "18px 22px 14px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: c.sand }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F8E5E1", color: "#a8392b", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.danger }} />Urgent · {shift.current_tier ? TIER_LABEL[shift.current_tier] : "Tier 3"}
            </div>
            <h2 style={{ fontFamily: font.display, fontSize: 20, fontWeight: font.displayWeight, margin: "0 0 3px" }}>Assign manually</h2>
            <div style={{ fontSize: 12.5, color: c.muted2 }}>{typeLabel(shift)} · {dateLabel(shift.shift_date)}</div>
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
          {/* Cleaning Manager — her own section at the top on EVERY shift type,
              because she is above the tiers and belongs in no Tier bucket. On a
              wipeover she is assignable as a working cleaner; elsewhere the row
              shows her auto-roster status read-only. */}
          {(() => {
            // Several cleaners can hold the role at once, so this lists all of
            // them rather than picking one.
            const mgrs = cleaners.filter((cl) => cl.is_team_leader);
            if (!mgrs.length) return null;
            return (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>{mgrs.length > 1 ? "Cleaning Managers" : "Cleaning Manager"}</div>
                <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {mgrs.map((m, i) => renderRow(m, i === mgrs.length - 1))}
                </div>
                {!isWipeover && (
                  <div style={{ fontSize: 11, color: c.faint, marginTop: 6, lineHeight: 1.4 }}>
                    Auto-rostered — notification only, doesn't fill a cleaner slot.
                  </div>
                )}
              </div>
            );
          })()}
          {(["tier_1", "tier_2", "tier_3"] as const).map((t) => {
            // Show every eligible cleaner in the tier, whatever their state — the
            // row's status + actions reflect it. (Accepted/offered/declined cleaners
            // were previously filtered out; they belong here now so an admin can
            // withdraw, take off, or re-offer them.)
            //
            // Within a tier the people still worth chasing come FIRST: someone who
            // has already accepted or declined needs no decision, so sinking them
            // keeps the actionable rows together at the top of each section. This
            // is ordering only — nothing is hidden, and every action stays.
            const rank = (cl: Cleaner) => {
              const st = byCleaner.get(cl.id)?.status;
              if (!st || st === "no_response" || st === "send_failed") return 0; // needs a decision
              if (st === "offered") return 1;                                     // waiting on them
              return 2;                                                           // settled
            };
            const inTier = cleaners
              .filter((cl) => cl.tier === t && !cl.is_team_leader)
              .sort((a2, b2) => rank(a2) - rank(b2) || a2.full_name.localeCompare(b2.full_name));
            if (!inTier.length) return null;
            return (
              <div key={t} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>{TIER_LABEL[t]}</span>
                  {/* How many in this tier still need a decision — lets an admin
                      skip a tier at a glance instead of reading every row. */}
                  {(() => {
                    const open = inTier.filter((cl) => rank(cl) === 0).length;
                    return <span style={{ fontSize: 10.5, color: c.faint, fontWeight: 600 }}>{open > 0 ? `${open} to offer` : "all contacted"}</span>;
                  })()}
                </div>
                <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
                  {inTier.map((cl, i) => renderRow(cl, i === inTier.length - 1))}
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ flex: "none", padding: "14px 22px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12, color: c.faint }}>Cleaners are notified of any change immediately.</span>
          <button onClick={onClose} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Done</button>
        </div>
      </div>
      {pending && (() => {
        const name = pending.cleaner.full_name;
        const when = `the ${typeLabel(shift)} on ${dateLabel(shift.shift_date)}`;
        const M: Record<PendingAction["kind"], { title: string; message: ReactNode; confirm: string; danger?: boolean }> = {
          offer:    { title: "Send shift offer", message: <>Send a WhatsApp offer to <b>{name}</b> for {when}? They'll get an Accept/Decline message.</>, confirm: "Send offer" },
          reoffer:  { title: "Re-offer shift",   message: <>Re-send the offer to <b>{name}</b> for {when}? They'll get an Accept/Decline message.</>, confirm: "Re-offer" },
          withdraw: { title: "Withdraw offer",   message: <>Withdraw this offer to <b>{name}</b>? Their offer is cancelled and they'll be told it's no longer available.</>, confirm: "Withdraw", danger: true },
          cancel:   { title: "Take off shift",   message: <>Take <b>{name}</b> off this shift? The spot reopens and they'll be notified.</>, confirm: "Take off shift", danger: true },
          add:      { title: "Add as accepted",  message: <>Add <b>{name}</b> as accepted without sending an offer? They'll be told they're booked for {when}.</>, confirm: "Add as accepted" },
        };
        const m = M[pending.kind];
        return (
          <ConfirmDialog
            title={m.title} message={m.message} confirmLabel={m.confirm} danger={m.danger}
            busy={busyId === pending.cleaner.id}
            onConfirm={() => { const p = pending; setPending(null); runPending(p); }}
            onCancel={() => setPending(null)}
          />
        );
      })()}
    </div>
  );
}

import { useEffect, useState } from "react";
import { c, SHIFT_TYPE_LABEL, TIER_LABEL } from "../theme";
import { Avatar, Modal, Spin } from "./ui";
import { getCleanerShiftHistory } from "../lib/api";
import { acceptRate, monthYear, shiftDateTimeLabel } from "../lib/format";
import type { AssignmentStatus, Cleaner, CleanerReliability, CleanerShiftHistory } from "../lib/types";

// How each assignment status reads in the history list, with a dot colour. These
// are the cleaner's OWN outcomes per shift — accepted / declined / cancelled /
// still-offered / no-response — plus the auto-rostered "team_lead" row.
const STATUS_META: Record<AssignmentStatus, { label: string; color: string }> = {
  accepted: { label: "Accepted", color: "#2c6446" },
  team_lead: { label: "Rostered (Manager)", color: "#2c6446" },
  declined: { label: "Declined", color: "#9a7320" },
  cancelled: { label: "Cancelled", color: "#a8392b" },
  no_response: { label: "No response", color: "#8a8478" },
  offered: { label: "Offered", color: "#3d6fae" },
  send_failed: { label: "Send failed", color: "#a8392b" },
};

// Read-only profile: who the cleaner is, their reliability breakdown, and every
// shift they've been rostered on / offered. Opened by clicking a row on the
// Cleaners page. cancelWeight is passed in so the headline % matches the table.
export function CleanerProfileModal({ cleaner, reliability, cancelWeight = 1, onClose }: {
  cleaner: Cleaner;
  reliability?: CleanerReliability;
  cancelWeight?: number;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<CleanerShiftHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setErr(null);
    getCleanerShiftHistory(cleaner.id)
      .then((rows) => { if (live) setHistory(rows); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Failed to load shift history"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [cleaner.id]);

  const acc = reliability?.accepted_count ?? 0;
  const dec = reliability?.declined_count ?? 0;
  const can = reliability?.cancelled_count ?? 0;
  const rate = acceptRate(acc, dec, can, cancelWeight);

  const tierLabel = cleaner.is_team_leader ? "Cleaning Manager" : TIER_LABEL[cleaner.tier] ?? cleaner.tier;
  const avBg = cleaner.is_team_leader ? c.green : cleaner.tier === "tier_1" ? c.greenMid : cleaner.tier === "tier_2" ? c.warn : "#c4bdb0";

  return (
    <Modal title="Cleaner profile" onClose={onClose} width={620}>
      {/* Header: identity + contact */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <Avatar name={cleaner.full_name} size={46} bg={avBg} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            {cleaner.full_name}
            <span style={{ fontSize: 11, color: cleaner.status === "active" ? "#2c6446" : "#8a8478", background: cleaner.status === "active" ? "#E7F1EA" : "#efece4", padding: "1px 8px", borderRadius: 10, fontWeight: 600 }}>
              {cleaner.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 2 }}>
            {tierLabel} · Joined {monthYear(cleaner.created_at)}
          </div>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 2 }}>
            {cleaner.phone}{cleaner.email ? ` · ${cleaner.email}` : ""}
          </div>
        </div>
      </div>

      {/* Reliability breakdown — same figures as the Cleaners table. */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <Stat label="Accept rate" value={rate === null ? "—" : `${rate}%`} big />
        <Stat label="Accepted" value={String(acc)} color="#2c6446" />
        <Stat label="Declined" value={String(dec)} color="#9a7320" />
        <Stat label="Cancelled" value={String(can)} color="#a8392b" />
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, marginBottom: 8 }}>
        Shift history {history.length > 0 && <span style={{ color: c.faint, fontWeight: 600 }}>· {history.length}</span>}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 2px", color: c.muted2, fontSize: 12.5 }}>
          <Spin size={16} color={c.greenMid} /> Loading shifts…
        </div>
      ) : err ? (
        <div style={{ fontSize: 12.5, color: c.danger, padding: "12px 0" }}>{err}</div>
      ) : history.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.muted, padding: "12px 0" }}>
          This cleaner hasn't been rostered on or offered any shifts yet.
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflowY: "auto", border: `1px solid ${c.border3}`, borderRadius: 10 }}>
          {history.map((h, i) => {
            const meta = STATUS_META[h.status] ?? { label: h.status, color: c.muted2 };
            return (
              <div key={h.assignment_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i > 0 ? `1px solid ${c.rowBd}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{SHIFT_TYPE_LABEL[h.shift_type] ?? h.shift_type}</div>
                  <div style={{ fontSize: 11.5, color: c.muted }}>
                    {shiftDateTimeLabel(h.shift_date, h.start_time)}
                    {h.is_manual_override ? " · added manually" : ""}
                    {h.shift_status === "cancelled" ? " · shift cancelled" : ""}
                  </div>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: meta.color, whiteSpace: "nowrap" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color }} />
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div style={{ flex: 1, background: c.panel, border: `1px solid ${c.border3}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: big ? 20 : 16, fontWeight: 700, color: color ?? c.ink, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, letterSpacing: "0.04em", textTransform: "uppercase", color: c.muted2, marginTop: 3 }}>{label}</div>
    </div>
  );
}

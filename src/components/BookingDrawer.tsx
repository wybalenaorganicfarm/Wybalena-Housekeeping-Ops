import { c, font } from "../theme";
import { Icon } from "./Icon";
import { dateTimeLabel, statusOf } from "../lib/format";
import type { Booking, Shift } from "../lib/types";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${c.rowBd}` }}>
      <span style={{ fontSize: 11.5, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: c.body, fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export function BookingDrawer({ booking, shift, onClose, onViewShift }: {
  booking: Booking; shift?: Shift; onClose: () => void; onViewShift: (s: Shift) => void;
}) {
  const ss = shift ? statusOf(shift) : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,25,.34)", zIndex: 55, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", height: "100%", background: c.sand, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px -12px rgba(20,30,25,.28)" }}>
        {/* header */}
        <div style={{ flex: "none", padding: "18px 22px 16px", borderBottom: `1px solid ${c.border}`, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: booking.is_cancelled ? "#fbeae8" : "#e7f0ed", color: booking.is_cancelled ? "#a8392b" : "#21564b", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: booking.is_cancelled ? c.danger : c.greenMid }} />{booking.is_cancelled ? "Cancelled" : "Confirmed"}
                </span>
                <span style={{ background: "#f0eee9", color: "#6b665c", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700, padding: "2px 8px", borderRadius: 5 }}>Google Calendar</span>
              </div>
              <h2 style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>{booking.guest_name || "Unnamed booking"}</h2>
              <div style={{ fontSize: 12.5, color: c.muted2 }}>{booking.nights} night{booking.nights === 1 ? "" : "s"}{booking.guest_count != null ? ` · ${booking.guest_count} guest${booking.guest_count === 1 ? "" : "s"}` : ""}</div>
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, flex: "none", border: `1px solid ${c.border}`, background: "#fff", borderRadius: 6, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} strokeWidth={1.8} /></button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 22px 24px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 4 }}>Booking details</div>
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "2px 16px", marginBottom: 20 }}>
            <Row label="Guest" value={booking.guest_name || "—"} />
            <Row label="Check-in" value={dateTimeLabel(booking.check_in)} />
            <Row label="Check-out" value={dateTimeLabel(booking.check_out)} />
            <Row label="Nights" value={booking.nights} />
            <Row label="Guests" value={booking.guest_count ?? "—"} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0" }}>
              <span style={{ fontSize: 11.5, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>Calendar event</span>
              <span style={{ fontSize: 11.5, color: c.faint, textAlign: "right", wordBreak: "break-all" }}>{booking.gcal_event_id || "—"}</span>
            </div>
          </div>

          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Cleaning shift</div>
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: shift ? "14px 16px" : 16 }}>
            {shift && ss ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: ss.bg, color: ss.fg, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 20 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: ss.dot }} />{ss.label}</span>
                  <span style={{ fontSize: 12.5, color: c.muted2 }}>{dateTimeLabel(shift.shift_date + "T" + shift.start_time)}</span>
                </div>
                <button onClick={() => onViewShift(shift)} style={{ width: "100%", background: c.green, color: "#fff", border: "none", borderRadius: 7, padding: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                  View shift for this booking <Icon name="chevronRight" size={15} strokeWidth={2.2} />
                </button>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: c.faint, textAlign: "center", padding: "6px 0" }}>No cleaning shift linked to this booking.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

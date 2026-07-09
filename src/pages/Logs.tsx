import { useEffect, useMemo, useState } from "react";
import { c, font, SHIFT_TYPE_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui";
import { AUDIT_PAGE_SIZE, getAuditLogs, getRecentFailureCount } from "../lib/api";
import { describe, parseCron } from "../lib/cron";
import { useGoogleReconnect } from "../lib/useGoogleReconnect";
import { WhatsAppReconnectModal } from "../components/WhatsAppReconnectModal";
import type { AuditLogResolved, AuditStatus } from "../lib/types";

function failureHaystack(log: AuditLogResolved): string {
  const notWorking = (log.detail?.not_working as unknown[] | undefined)?.map(String).join(" ") ?? "";
  return `${log.summary} ${log.error_message ?? ""} ${notWorking}`.toLowerCase();
}

// A log row is a Google-connection failure the admin can fix with one click when
// it's a failed/warning entry that names Gmail or Calendar (or a Google token
// error). Health-check rows carry the broken services in detail.not_working.
function isGoogleFailure(log: AuditLogResolved): boolean {
  if (log.status !== "failed" && log.status !== "warning") return false;
  return /gmail|google calendar|\bcalendar\b|google|refresh.?token/.test(failureHaystack(log));
}

// A WhatsApp-channel failure — offer/reminder sends bounced, or health-check
// flagged the messaging channel. Fixed by re-scanning the Whapi QR.
function isWhatsAppFailure(log: AuditLogResolved): boolean {
  if (log.status !== "failed" && log.status !== "warning") return false;
  return /whatsapp|whapi|messaging channel|channel needs reconnect|channel authorization/.test(failureHaystack(log));
}

// Cron expression → plain-English local time, e.g. "2 8 * * 3" → "Every Wednesday
// at 1:32 PM (IST)". Falls back to the raw expression if it isn't parseable.
function humanCron(expr: string): string {
  const f = parseCron(expr.trim());
  return f ? describe(f) : expr;
}

// manage-cron summaries embed the raw cron ("…rescheduled … to 2 8 * * 3."). Swap
// that expression for the readable time so the log row shows an actual time.
const CRON_IN_TEXT = /(?:\d+|\*)\s+(?:\d+|\*)\s+[\d*,\-/]+\s+[\d*,\-/]+\s+[\d*,\-/]+/;
function humanizeSummary(summary: string, source: string): string {
  if (source !== "manage-cron") return summary;
  const m = summary.match(CRON_IN_TEXT);
  return m ? summary.replace(m[0], humanCron(m[0])) : summary;
}

// source (code) -> plain-English display name (Spec §4).
const SOURCE_LABEL: Record<string, string> = {
  "sync-bookings": "Weekly Booking Sync",
  "confirm-reminder": "Confirmation Reminder",
  "offer-tier-1": "Tier 1 Offers",
  "remind-nonresponders": "Non-Responder Reminders",
  "escalate-tier-2": "Tier 2 Escalation",
  "escalate-tier-3": "Tier 3 Escalation",
  "pre-shift-reminder": "Pre-Shift Reminders",
  "cancellation-followup": "Cancellation Follow-up",
  "whatsapp-inbound": "WhatsApp Reply Received",
  "health-check": "Connection Health Check",
  "wipeover-notify": "Wipeover Cleaning",
  "google-oauth-callback": "Google Reconnected",
  // Manual / admin actions
  "manual-assign": "Manual Assignment",
  "confirm-shifts": "Shift Confirmation",
  "confirm-cancellation": "Cancellation Confirmed",
  "add-cleaner": "Cleaner Added",
  "remove-cleaner": "Cleaner Removed",
  "set-cleaner-status": "Cleaner Status Changed",
  "provision-user": "User Invited",
  "remove-user": "User Removed",
  "activate-self": "Account Activated",
};

const STATUS_META: Record<AuditStatus, { label: string; dot: string; fg: string; bg: string }> = {
  success: { label: "Success", dot: c.greenMid, fg: "#256b43", bg: "#eaf4ee" },
  failed: { label: "Failed", dot: c.danger, fg: "#a8392b", bg: "#fbeae8" },
  warning: { label: "Warning", dot: c.warn, fg: "#9a6512", bg: "#fdf4e3" },
  skipped: { label: "Skipped", dot: c.faint, fg: "#6b665c", bg: "#f0eee9" },
};

const TRIGGER_LABEL: Record<string, string> = {
  cron: "Scheduled", webhook: "Webhook", manual: "Manual", system: "System",
};

const STATUS_CHIPS: [string, string][] = [
  ["all", "All"], ["success", "Success"], ["failed", "Failed"], ["warning", "Warning"], ["skipped", "Skipped"],
];

// "Mon 23 Jun · 3:30 PM" in Australia/Sydney venue local time (DST-aware).
function logTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit",
  });
  return `${date} · ${time}`;
}

function entityLine(log: AuditLogResolved): string | null {
  const parts: string[] = [];
  if (log.shift) parts.push(`Shift: ${SHIFT_TYPE_LABEL[log.shift.shift_type] ?? log.shift.shift_type} · ${log.shift.shift_date}`);
  if (log.cleaner) parts.push(`Cleaner: ${log.cleaner.full_name}`);
  if (log.booking) parts.push(`Booking: ${log.booking.guest_name ?? "Guest"} · ${log.booking.check_in.slice(0, 10)} → ${log.booking.check_out.slice(0, 10)}`);
  return parts.length ? parts.join("  ·  ") : null;
}

// Plain-English labels for the technical keys stored in `detail`.
const DETAIL_LABEL: Record<string, string> = {
  mode: "Action", count: "Cleaners offered", open_spots: "Open spots",
  cleaners: "Cleaners offered", offers: "Offers sent", offered: "Cleaners offered",
  cleaners_messaged: "Cleaners messaged", createdBookings: "Bookings created",
  createdShifts: "Shifts created", cancellations: "Cancellations", gapsRaised: "Venue gaps raised",
  cancelledShifts: "Shifts cancelled", notified: "People notified", pending: "Pending confirmations",
  nights: "Nights", gap_days: "Gap (days)", accepted: "Accepted so far", required: "Cleaners required",
  status: "New status", role: "Role", shift_type: "Shift type", from: "From", to: "To",
  phone: "Phone number", text: "Message text",
};

// Raw UUID / internal-reference keys an ops manager never needs to see.
const isIdKey = (k: string) => k === "by" || k === "id" || /_?id$/i.test(k) || /event_id$/i.test(k);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function humanizeKey(k: string): string {
  if (DETAIL_LABEL[k]) return DETAIL_LABEL[k];
  return titleCase(k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function formatVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    // Arrays of cleaner/people objects → list their names instead of a bare count.
    const names = v.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>).full_name ?? (x as Record<string, unknown>).name : null)).filter(Boolean);
    if (names.length === v.length && names.length > 0) return names.join(", ");
    return String(v.length);
  }
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^[a-z]+$/.test(v)) return titleCase(v);
  return String(v);
}

function detailLines(detail: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(detail)
    .filter(([k, v]) => !isIdKey(k) && v != null && v !== "")
    .map(([k, v]) => ({ label: humanizeKey(k), value: k === "schedule" && typeof v === "string" ? humanCron(v) : formatVal(v) }));
}

export function Logs() {
  const [rows, setRows] = useState<AuditLogResolved[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [failures24h, setFailures24h] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [waModal, setWaModal] = useState(false);

  const { reconnect, busy: reconnecting } = useGoogleReconnect(() => setReloadKey((k) => k + 1));

  // Reset to first page whenever a filter changes.
  useEffect(() => { setPage(0); }, [status, source, from, to, search]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getAuditLogs({
      status, source,
      from: from ? new Date(from + "T00:00:00").toISOString() : undefined,
      to: to ? new Date(to + "T23:59:59").toISOString() : undefined,
      search, page,
    }).then((res) => {
      if (!live) return;
      setRows(res.rows); setTotal(res.total); setLoading(false);
    });
    return () => { live = false; };
  }, [status, source, from, to, search, page, reloadKey]);

  useEffect(() => { getRecentFailureCount().then(setFailures24h); }, []);

  const anyFilter = status !== "all" || source !== "all" || from || to || search.trim();
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  const sourceOptions = useMemo(
    () => [["all", "All functions"] as [string, string], ...Object.entries(SOURCE_LABEL)],
    [],
  );

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="System Logs" subtitle="A record of everything the system has done automatically." />

      {/* Filter bar */}
      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "10px 24px" }}>
        {STATUS_CHIPS.map(([k, l]) => {
          const on = status === k;
          return (
            <span key={k} onClick={() => setStatus(k)} style={{ background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>{l}</span>
          );
        })}
        <span style={{ width: 1, height: 22, background: c.border, margin: "0 4px" }} />
        <select value={source} onChange={(e) => setSource(e.target.value)} style={selStyle}>
          {sourceOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={selStyle} title="From date" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={selStyle} title="To date" />
        <div style={{ position: "relative", minWidth: 180, flex: 1, maxWidth: 280 }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: c.muted2, display: "flex", pointerEvents: "none" }}><Icon name="search" size={13} strokeWidth={2} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary" style={{ ...selStyle, width: "100%", boxSizing: "border-box", padding: "6px 8px 6px 28px" }} />
        </div>
        <button onClick={() => setStatus(status === "failed" ? "all" : "failed")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: status === "failed" ? c.danger : "#fff", color: status === "failed" ? "#fff" : c.danger, border: `1px solid ${status === "failed" ? c.danger : "#e6c4be"}`, borderRadius: 6, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          <Icon name="alert" size={13} strokeWidth={2} /> Failed only
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {/* Failure banner */}
        {failures24h > 0 && !bannerDismissed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fbeae8", border: `1px solid #e6c4be`, color: "#a8392b", borderRadius: 8, padding: "11px 14px", marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            <Icon name="alert" size={16} strokeWidth={2} />
            <span style={{ flex: 1 }}>⚠️ {failures24h} failure{failures24h === 1 ? "" : "s"} in the last 24 hours. Review below.</span>
            <button onClick={() => { setStatus("failed"); }} style={{ background: c.danger, color: "#fff", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Show failures</button>
            <button onClick={() => setBannerDismissed(true)} style={{ background: "none", border: "none", color: "#a8392b", cursor: "pointer", display: "flex" }}><Icon name="x" size={15} strokeWidth={2} /></button>
          </div>
        )}

        {loading ? <Spinner /> : rows.length === 0 ? (
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: c.faint, fontSize: 13 }}>
            {anyFilter
              ? "No log entries match your filters. Try adjusting the date range or status."
              : "The system hasn't run any automated jobs yet. Logs will appear here once the first scheduled jobs execute."}
          </div>
        ) : (
          <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            {rows.map((log, i) => {
              const m = STATUS_META[log.status] ?? STATUS_META.skipped;
              const open = expanded === log.id;
              const entity = entityLine(log);
              const detailRows = log.detail ? detailLines(log.detail) : [];
              return (
                <div key={log.id} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${c.rowBd}` : "none", borderLeft: `3px solid ${m.dot}` }}>
                  <div onClick={() => setExpanded(open ? null : log.id)} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.dot, flex: "none", marginTop: 5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{log.event_label}</span>
                        <span style={{ background: m.bg, color: m.fg, fontSize: 10, letterSpacing: "0.03em", textTransform: "uppercase", fontWeight: 700, padding: "1px 7px", borderRadius: 5 }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#5d665f", marginTop: 4, lineHeight: 1.5 }}>{humanizeSummary(log.summary, log.source)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11, color: c.faint }}>
                        <span>{SOURCE_LABEL[log.source] ?? log.source}</span>
                        <span>·</span>
                        <span>{TRIGGER_LABEL[log.triggered_by] ?? log.triggered_by}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: c.faint, flex: "none", whiteSpace: "nowrap", marginTop: 2 }}>{logTime(log.created_at)}</span>
                    <span style={{ flex: "none", color: c.faint, marginTop: 2 }}><Icon name={open ? "chevronDown" : "chevronRight"} size={15} /></span>
                  </div>

                  {open && (
                    <div style={{ padding: "0 16px 14px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {log.error_message && (
                        <div style={{ background: "#fbeae8", border: `1px solid #e6c4be`, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, color: "#a8392b", fontFamily: font.body }}>
                          <span style={{ fontWeight: 700 }}>Error: </span>{log.error_message}
                        </div>
                      )}
                      {/* Skipped/warning runs aren't failures — spell out why the job did nothing. */}
                      {!log.error_message && (log.status === "skipped" || log.status === "warning") && (
                        <div style={{ background: "#f4f2ec", border: `1px solid ${c.border}`, borderRadius: 6, padding: "9px 11px", fontSize: 12.5, color: c.body }}>
                          <span style={{ fontWeight: 700 }}>Reason it was {log.status === "warning" ? "flagged" : "skipped"}: </span>{humanizeSummary(log.summary, log.source)}
                        </div>
                      )}
                      {isGoogleFailure(log) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#f4f2ec", border: `1px solid ${c.border}`, borderRadius: 6, padding: "10px 12px" }}>
                          <div style={{ flex: 1, fontSize: 12.5, color: c.body, lineHeight: 1.45 }}>
                            The Google login (Gmail + Calendar) needs re-authorising. Reconnect in one click — no console or client IDs needed.
                          </div>
                          <Button kind="danger" onClick={reconnect} loading={reconnecting} style={{ borderRadius: 8, whiteSpace: "nowrap" }}>
                            <Icon name="refresh" size={13} strokeWidth={2.2} /> Reconnect Google
                          </Button>
                        </div>
                      )}
                      {isWhatsAppFailure(log) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#f4f2ec", border: `1px solid ${c.border}`, borderRadius: 6, padding: "10px 12px" }}>
                          <div style={{ flex: 1, fontSize: 12.5, color: c.body, lineHeight: 1.45 }}>
                            The WhatsApp messaging channel needs re-authorising. Scan a QR with the business WhatsApp to reconnect.
                          </div>
                          <Button kind="danger" onClick={() => setWaModal(true)} style={{ borderRadius: 8, whiteSpace: "nowrap" }}>
                            <Icon name="refresh" size={13} strokeWidth={2.2} /> Reconnect WhatsApp
                          </Button>
                        </div>
                      )}
                      {entity && (
                        <div style={{ fontSize: 12.5, color: c.body }}>
                          <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: c.muted2, fontWeight: 700, marginRight: 8 }}>Linked</span>
                          {entity}
                        </div>
                      )}
                      {detailRows.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px" }}>
                          {detailRows.map((d) => (
                            <div key={d.label} style={{ minWidth: 120 }}>
                              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: c.muted2, fontWeight: 700 }}>{d.label}</div>
                              <div style={{ fontSize: 12.5, color: c.body, marginTop: 2 }}>{d.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {log.status === "success" && !log.error_message && !entity && detailRows.length === 0 && (
                        <div style={{ fontSize: 12, color: c.faint }}>No extra detail recorded.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, fontSize: 12.5, color: c.muted }}>
            <span>{total} entr{total === 1 ? "y" : "ies"} · page {page + 1} of {pageCount}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} style={pageBtn(page === 0)}>Previous</button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} style={pageBtn(page >= pageCount - 1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {waModal && <WhatsAppReconnectModal onClose={() => setWaModal(false)} onConnected={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  border: `1px solid ${c.border3}`, borderRadius: 6, padding: "6px 8px", fontSize: 12.5,
  color: c.ink, background: "#fff", outline: "none", fontFamily: font.body,
};

function pageBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "#fff", color: disabled ? c.faint : c.body, border: `1px solid ${c.border3}`,
    borderRadius: 6, padding: "6px 13px", fontSize: 12.5, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
  };
}

import { useCallback, useEffect, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "./Icon";
import { Button } from "./ui";
import { getConnectionStatus, type ConnectionStatus } from "../lib/api";
import { useGoogleReconnect } from "../lib/useGoogleReconnect";
import { WhatsAppReconnectModal } from "./WhatsAppReconnectModal";

// Right-rail "Connections" widget for the Dashboard. Shows each integration's live
// status and, whenever a Google connection (Gmail/Calendar) is broken, a one-click
// "Reconnect Google" button that runs the OAuth flow — no console, no client IDs.
function statusMeta(configured: boolean, ok: boolean): { label: string; dot: string; fg: string } {
  if (!configured) return { label: "Not set up", dot: c.faint, fg: c.faint };
  if (ok) return { label: "Connected", dot: c.greenMid, fg: "#256b43" };
  return { label: "Needs attention", dot: c.danger, fg: c.danger };
}

export function ConnectionsCard() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [waModal, setWaModal] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getConnectionStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const { reconnect, busy } = useGoogleReconnect(load);

  // Google is "broken" if either Gmail or Calendar is configured but not ok.
  const googleBroken = (status?.results ?? []).some(
    (r) => r.provider === "google" && r.configured && !r.ok,
  );
  // WhatsApp (Whapi) broken → offer the QR reconnect.
  const whatsappBroken = (status?.results ?? []).some(
    (r) => r.name === "whapi" && r.configured && !r.ok,
  );

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Connections</div>
          {googleBroken && <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.danger }} />}
        </div>
        <button onClick={load} title="Refresh" style={{ background: "none", border: "none", color: c.muted2, cursor: "pointer", display: "flex", padding: 2 }}>
          <Icon name="refresh" size={13} strokeWidth={2} />
        </button>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${c.border2}`, borderRadius: 12, padding: "6px 13px" }}>
        {loading && !status ? (
          <div style={{ padding: "12px 0", fontSize: 12.5, color: c.faint }}>Checking connections…</div>
        ) : !status ? (
          <div style={{ padding: "12px 0", fontSize: 12.5, color: c.faint }}>Couldn't load status.</div>
        ) : (
          status.results.map((r, i) => {
            const m = statusMeta(r.configured, r.ok);
            return (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${c.rowBd}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.dot, flex: "none" }} />
                <span style={{ fontSize: 12.5, color: c.body, flex: 1, minWidth: 0 }}>{r.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: m.fg, whiteSpace: "nowrap" }}>{m.label}</span>
              </div>
            );
          })
        )}
      </div>

      {whatsappBroken && (
        <div style={{ marginTop: 10 }}>
          <Button kind="danger" onClick={() => setWaModal(true)} style={{ width: "100%", borderRadius: 9 }}>
            <Icon name="refresh" size={14} strokeWidth={2.2} /> Reconnect WhatsApp
          </Button>
          <div style={{ fontSize: 11, color: c.faint, marginTop: 6, lineHeight: 1.45 }}>
            Scan a QR with the business WhatsApp to re-authorise the messaging channel.
          </div>
        </div>
      )}

      {googleBroken && (
        <div style={{ marginTop: 10 }}>
          <Button kind="danger" onClick={reconnect} loading={busy} style={{ width: "100%", borderRadius: 9 }}>
            <Icon name="refresh" size={14} strokeWidth={2.2} /> Reconnect Google
          </Button>
          <div style={{ fontSize: 11, color: c.faint, marginTop: 6, lineHeight: 1.45 }}>
            Sign in with the Google account and approve access — Gmail and Calendar reconnect together.
          </div>
        </div>
      )}

      {waModal && <WhatsAppReconnectModal onClose={() => setWaModal(false)} onConnected={load} />}
      {!googleBroken && status?.google?.email && (
        <div style={{ fontSize: 11, color: c.faint, marginTop: 8 }}>
          Google linked as {status.google.email}.{" "}
          <button onClick={reconnect} disabled={busy} style={{ background: "none", border: "none", color: c.teal, fontWeight: 600, cursor: busy ? "wait" : "pointer", padding: 0, fontSize: 11 }}>
            Reconnect
          </button>
        </div>
      )}
    </div>
  );
}

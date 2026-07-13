import { useCallback, useEffect, useState } from "react";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { Button, Card, Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { getConnectionStatus, type ConnectionResult, type ConnectionStatus } from "../lib/api";
import { useGoogleReconnect } from "../lib/useGoogleReconnect";
import { WhatsAppReconnectModal } from "../components/WhatsAppReconnectModal";
import { toastOk } from "../lib/toast";

// Connections lives under Administration. It's almost always healthy, so it
// doesn't need dashboard real estate — a dropped connection surfaces on its own
// via the daily health-check → Alerts section. Here an admin can, on demand:
//   • see every integration's live status,
//   • re-run all read-only probes ("Run Connection Check"),
//   • reconnect any individual integration (Google OAuth / WhatsApp QR).
function statusMeta(configured: boolean, ok: boolean): { label: string; dot: string; fg: string; bg: string } {
  if (!configured) return { label: "Not set up", dot: c.faint, fg: c.faint, bg: "#f2f0ea" };
  if (ok) return { label: "Connected", dot: c.greenMid, fg: "#256b43", bg: "#eaf3ed" };
  return { label: "Needs attention", dot: c.danger, fg: c.danger, bg: "#F8E5E1" };
}

// Which integrations can be re-authorised from here, and how.
function reconnectKind(r: ConnectionResult): "google" | "whapi" | null {
  if (r.provider === "google") return "google";
  if (r.name === "whapi") return "whapi";
  return null; // e.g. the app database — managed infra, nothing to reconnect
}

export function Connections() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [waModal, setWaModal] = useState(false);

  const runCheck = useCallback(async (announce = false) => {
    setChecking(true);
    try {
      const s = await getConnectionStatus();
      setStatus(s);
      setCheckedAt(new Date());
      if (announce) toastOk("Connection check complete.");
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { runCheck(); }, [runCheck]);

  const { reconnect, busy } = useGoogleReconnect(() => runCheck());

  if (loading) return <Spinner />;

  const rows = status?.results ?? [];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Connections"
        subtitle="Live status of the app's integrations"
        right={
          <Button onClick={() => runCheck(true)} loading={checking}>
            <Icon name="refresh" size={14} strokeWidth={2.2} /> Run Connection Check
          </Button>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px 40px" }}>
        <div style={{ maxWidth: 620 }}>
          {!status ? (
            <Card style={{ padding: 24, textAlign: "center", color: c.faint, fontSize: 13 }}>
              Couldn't load connection status. Try Run Connection Check.
            </Card>
          ) : (
            <Card style={{ padding: "4px 16px" }}>
              {rows.map((r, i) => {
                const m = statusMeta(r.configured, r.ok);
                const kind = reconnectKind(r);
                const broken = r.configured && !r.ok;
                return (
                  <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 0", borderTop: i === 0 ? "none" : `1px solid ${c.rowBd}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: m.dot, flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: c.body }}>{r.label}</div>
                      {broken && r.detail && (
                        <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, lineHeight: 1.4 }}>{r.detail}</div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: m.fg, background: m.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap", flex: "none" }}>{m.label}</span>
                    {kind && (
                      <Button
                        kind={broken ? "danger" : "secondary"}
                        loading={kind === "google" && busy}
                        onClick={() => kind === "google" ? reconnect() : setWaModal(true)}
                        style={{ borderRadius: 9, padding: "6px 12px", fontSize: 12, flex: "none" }}
                      >
                        <Icon name="refresh" size={13} strokeWidth={2.2} /> Reconnect
                      </Button>
                    )}
                  </div>
                );
              })}
            </Card>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11.5, color: c.faint }}>
              {checkedAt ? `Last checked ${checkedAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : ""}
              {status?.google?.email ? ` · Google linked as ${status.google.email}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 9, marginTop: 20, padding: "13px 15px", background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 10 }}>
            <Icon name="shield" size={16} color="#5e7a6a" strokeWidth={1.9} />
            <div style={{ fontSize: 12, color: "#41604f", lineHeight: 1.5 }}>
              Connections are checked automatically every day. If one drops unexpectedly, the system
              raises an alert in the <strong>Alerts</strong> section (and emails the admin), so it
              comes to your attention without checking this page.
            </div>
          </div>
        </div>
      </div>

      {waModal && <WhatsAppReconnectModal onClose={() => setWaModal(false)} onConnected={() => runCheck()} />}
    </div>
  );
}

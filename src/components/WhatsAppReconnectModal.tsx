import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "../theme";
import { Modal, Button, Spin } from "./ui";
import { confirmWhatsAppReconnected, getWhatsAppQr, getWhatsAppStatus } from "../lib/api";
import { toastOk } from "../lib/toast";

// "Reconnect WhatsApp" modal for the Whapi channel. Shows a fresh QR to scan with
// the WhatsApp phone, then polls the channel status until it reports AUTH — at
// which point offers/reminders can send again. Mirrors WhatsApp Web's flow.
export function WhatsAppReconnectModal({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "scan" | "connected" | "error">("loading");
  const [detail, setDetail] = useState<string>("");
  const poll = useRef<number | null>(null);
  const done = useRef(false);

  const stopPolling = () => { if (poll.current) { window.clearInterval(poll.current); poll.current = null; } };

  const finishConnected = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    stopPolling();
    setPhase("connected");
    try { await confirmWhatsAppReconnected(); } catch { /* audit-only, non-fatal */ }
    toastOk("WhatsApp reconnected.");
    onConnected?.();
  }, [onConnected]);

  const loadQr = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await getWhatsAppQr();
      if (res.status === "AUTH") { await finishConnected(); return; }
      if (!res.ok || !res.image) { setPhase("error"); setDetail(res.detail ?? "Couldn't get a QR code."); return; }
      setQr(res.image);
      setPhase("scan");
    } catch (e) {
      setPhase("error");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }, [finishConnected]);

  // Initial QR + status polling while the modal is open.
  useEffect(() => {
    loadQr();
    poll.current = window.setInterval(async () => {
      try {
        const s = await getWhatsAppStatus();
        if (s.authorized) finishConnected();
      } catch { /* transient — keep polling */ }
    }, 3000);
    return stopPolling;
  }, [loadQr, finishConnected]);

  return (
    <Modal title="Reconnect WhatsApp" onClose={onClose} width={420}>
      {phase === "connected" ? (
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#256b43" }}>WhatsApp connected</div>
          <div style={{ fontSize: 13, color: c.muted, marginTop: 6, lineHeight: 1.5 }}>
            The channel is authorised again — shift offers and reminders can send.
          </div>
          <Button onClick={onClose} style={{ marginTop: 18 }}>Done</Button>
        </div>
      ) : (
        <>
          <ol style={{ margin: "0 0 16px", paddingLeft: 20, fontSize: 13, color: c.body, lineHeight: 1.6 }}>
            <li>Open <strong>WhatsApp</strong> on the phone for the business number.</li>
            <li>Tap <strong>Settings → Linked devices → Link a device</strong>.</li>
            <li>Scan the code below.</li>
          </ol>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 240, background: "#f7f6f2", border: `1px solid ${c.border2}`, borderRadius: 12 }}>
            {phase === "loading" ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: c.muted }}>
                <Spin size={22} color={c.greenMid} /> <span style={{ fontSize: 12.5 }}>Generating QR…</span>
              </div>
            ) : phase === "error" ? (
              <div style={{ textAlign: "center", padding: 18, color: c.danger, fontSize: 12.5 }}>{detail || "Couldn't load the QR code."}</div>
            ) : (
              qr && <img src={qr} alt="WhatsApp login QR" width={220} height={220} style={{ borderRadius: 8, background: "#fff", padding: 6 }} />
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 11.5, color: c.faint }}>Waiting for you to scan… this updates automatically.</span>
            <Button kind="secondary" onClick={loadQr} disabled={phase === "loading"}>New QR</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

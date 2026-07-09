import { c } from "../theme";
import { Modal, Button } from "./ui";

// Static "Reconnect WhatsApp" guidance. WhatsApp/Whapi pairing is a QR scan done in
// the Whapi dashboard on the business phone — we deliberately DON'T poll the Whapi
// API from here (that made the page slow), we just walk the admin through it and let
// them refresh the connection status when they're done.
const WHAPI_PANEL_URL = "https://panel.whapi.cloud";

export function WhatsAppReconnectModal({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  return (
    <Modal title="Reconnect WhatsApp" onClose={onClose} width={440}>
      <div style={{ fontSize: 13, color: c.body, lineHeight: 1.55, marginBottom: 14 }}>
        The WhatsApp messaging channel needs re-linking to the business phone. This is
        done in the <strong>Whapi dashboard</strong> by scanning a QR, just like WhatsApp Web:
      </div>

      <ol style={{ margin: "0 0 16px", paddingLeft: 20, fontSize: 13, color: c.body, lineHeight: 1.7 }}>
        <li>Open the <strong>Whapi dashboard</strong> and log in (button below).</li>
        <li>Select your <strong>channel</strong>. If it needs authorising it will show a <strong>QR code</strong>.</li>
        <li>On the business phone, open <strong>WhatsApp → Settings → Linked devices → Link a device</strong>.</li>
        <li>Scan the QR shown in the Whapi dashboard.</li>
        <li>Wait until the channel status shows <strong>Connected</strong> (AUTH).</li>
      </ol>

      <div style={{ background: "#f4f2ec", border: `1px solid ${c.border2}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: c.muted, lineHeight: 1.5, marginBottom: 18 }}>
        If the channel shows <strong>Stopped</strong>, it's usually a trial/billing issue on the
        Whapi account — sort that out first, then re-scan.
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <a href={WHAPI_PANEL_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Button kind="secondary">Open Whapi dashboard ↗</Button>
        </a>
        <Button onClick={() => { onConnected?.(); onClose(); }}>I've reconnected — refresh</Button>
      </div>
    </Modal>
  );
}

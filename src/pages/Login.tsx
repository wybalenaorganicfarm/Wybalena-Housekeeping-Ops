import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { c, font, ROLE_LABEL } from "../theme";

const ROLES = [
  { key: "admin", name: "Admin", who: "Ashleigh" },
  { key: "team_leader", name: "Team Lead", who: "Zara" },
  { key: "super_admin", name: "Super Admin", who: "Julian" },
];

export function Login() {
  const { signIn } = useAuth();
  const [pickedRole, setPickedRole] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    const err = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
    // On success the AuthProvider session listener routes into the app.
  }

  const inp: React.CSSProperties = {
    width: "100%", border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "11px 13px",
    fontSize: 13.5, background: "#fff", color: c.ink, marginBottom: 16, outline: "none", display: "block",
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", color: c.ink }}>
      <div style={{ flex: "none", width: "46%", background: c.green, color: "#fff", padding: "48px 56px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: c.greenMid }} />
        <div>
          <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 23 }}>Wybalena</div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#7fa491", fontWeight: 600, marginTop: 3 }}>Housekeeping Operations</div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 420 }}>
          <h1 style={{ fontFamily: font.display, fontSize: 38, fontWeight: 700, lineHeight: 1.1, margin: 0 }}>The cockpit for every clean between guests.</h1>
          <p style={{ fontSize: 15, color: "#bcd2c5", lineHeight: 1.6, margin: "20px 0 0" }}>See, confirm, override and monitor every cleaning shift. The automation handles the offers and reminders — you stay in control.</p>
        </div>
        <div style={{ fontSize: 11.5, color: "#5e7d6c" }}>Wybalena Organic Farm · BYRON BAY HINTERLAND</div>
      </div>

      <div style={{ flex: 1, background: c.sand, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: "100%", maxWidth: 368 }}>
          <h2 style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, margin: 0 }}>Sign in</h2>
          <p style={{ fontSize: 13.5, color: c.muted2, margin: "7px 0 26px" }}>Welcome back. Sign in to continue.</p>

          <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 9 }}>Signing in as</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 22 }}>
            {ROLES.map((r) => (
              <div key={r.key} onClick={() => setPickedRole(r.key)} style={{
                border: `1.5px solid ${pickedRole === r.key ? c.greenMid : c.border3}`,
                background: pickedRole === r.key ? "#eef3ef" : "#fff",
                borderRadius: 8, padding: "11px 8px", textAlign: "center", cursor: "pointer",
              }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 10.5, color: c.muted2, marginTop: 2 }}>{r.who}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>Email</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={inp} />
          <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>Password</div>
          <input value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" style={{ ...inp, marginBottom: 20 }} />

          {error && (
            <div style={{ background: "#F8E5E1", color: "#a8392b", borderRadius: 7, padding: "10px 12px", fontSize: 12.5, fontWeight: 500, marginBottom: 14 }}>{error}</div>
          )}

          <button onClick={submit} disabled={busy} style={{ width: "100%", background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: 12, fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Signing in…" : `Sign in as ${ROLE_LABEL[pickedRole]}`}
          </button>
          <p style={{ fontSize: 11.5, color: c.faint, textAlign: "center", margin: "24px 0 0", lineHeight: 1.5 }}>Accounts are provisioned by the Super Admin.<br />Contact Julian if you need access.</p>
        </div>
      </div>
    </div>
  );
}

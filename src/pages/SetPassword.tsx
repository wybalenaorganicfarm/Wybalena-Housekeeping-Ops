import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { c, font } from "../theme";

export function SetPassword() {
  const { setPassword, signOut } = useAuth();
  const [password, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true); setError(null);
    const err = await setPassword(password);
    setBusy(false);
    if (err) setError(err);
    // On success the gate clears and the app routes in.
  }

  const inp: React.CSSProperties = {
    width: "100%", border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "11px 13px",
    fontSize: 13.5, background: "#fff", color: c.ink, marginBottom: 16, outline: "none", display: "block",
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", color: c.ink, background: c.sand, alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, color: c.green }}>Wybalena</div>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginTop: 3, marginBottom: 26 }}>Housekeeping Operations</div>

        <h2 style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, margin: 0 }}>Accept your invitation</h2>
        <p style={{ fontSize: 13.5, color: c.muted2, margin: "7px 0 26px" }}>Set a password to finish setting up your account.</p>

        <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>New password</div>
        <input value={password} onChange={(e) => setPw(e.target.value)} type="password" placeholder="Min 8 characters" style={inp} />
        <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 7 }}>Confirm password</div>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} type="password" style={{ ...inp, marginBottom: 20 }} />

        {error && <div style={{ background: "#F8E5E1", color: "#a8392b", borderRadius: 7, padding: "10px 12px", fontSize: 12.5, fontWeight: 500, marginBottom: 14 }}>{error}</div>}

        <button onClick={submit} disabled={busy} style={{ width: "100%", background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: 12, fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Saving…" : "Set password & continue"}
        </button>
        <button onClick={signOut} style={{ width: "100%", background: "none", color: c.muted2, border: "none", padding: 12, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>Cancel</button>
      </div>
    </div>
  );
}

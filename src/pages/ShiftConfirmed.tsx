// Standalone landing page for the email "Confirm Shift" button. Supabase Edge
// Functions can't serve HTML on the default domain (they rewrite text/html →
// text/plain), so confirm-shift-email does the work then redirects the browser
// here — a real app page that renders. No auth required; reads only query params.
import { c, font } from "../theme";

type Status = "confirmed" | "already" | "invalid" | "notfound";

const COPY: Record<Status, { ok: boolean; title: string; body: (label: string) => string }> = {
  confirmed: { ok: true, title: "Shift confirmed", body: (l) => `The ${l} shift has been confirmed. You can return to the email to confirm the other shifts.` },
  already: { ok: true, title: "Already confirmed", body: (l) => `The ${l} shift is already confirmed — no further action needed. You can return to the email to confirm the other shifts.` },
  invalid: { ok: false, title: "Link no longer valid", body: () => "This confirmation link is invalid or has expired. Please open the app to confirm the shift." },
  notfound: { ok: false, title: "Shift not found", body: () => "We couldn't find that shift. It may have been removed." },
};

export function ShiftConfirmed() {
  const params = new URLSearchParams(window.location.search);
  const status = (params.get("status") as Status) || "confirmed";
  const label = params.get("label") || "cleaning";
  const meta = COPY[status] ?? COPY.confirmed;
  const accent = meta.ok ? c.green : c.danger;

  return (
    <div style={{ minHeight: "100vh", background: "#eef0ee", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: font.body }}>
      <div style={{ width: 440, maxWidth: "100%", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 16px 50px rgba(20,30,25,.14)" }}>
        <div style={{ background: accent, textAlign: "center", padding: "30px 20px" }}>
          <div style={{ color: "#fff", fontSize: 46, lineHeight: 1 }}>{meta.ok ? "✓" : "⚠"}</div>
        </div>
        <div style={{ padding: "30px 28px 26px", textAlign: "center" }}>
          <div style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, color: c.ink, marginBottom: 10 }}>{meta.title}</div>
          <div style={{ fontSize: 14, color: c.muted, lineHeight: 1.6, marginBottom: 24 }}>{meta.body(label)}</div>
          <button onClick={() => window.close()} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 9, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Close this window
          </button>
          <div style={{ fontSize: 11.5, color: c.faint, marginTop: 14 }}>If the window doesn't close, you can close this tab manually.</div>
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { c, font } from "../theme";

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ background: "#fff", border: `1px solid ${c.border2}`, borderRadius: 12, ...style }}>
      {children}
    </div>
  );
}

export function Badge({ label, dot, bg, fg }: { label: string; dot?: string; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: bg, color: fg, fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 20 }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: dot }} />}
      {label}
    </span>
  );
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
export function Button({ children, onClick, kind = "primary", disabled, style, type }: {
  children: ReactNode; onClick?: () => void; kind?: BtnKind; disabled?: boolean; style?: CSSProperties; type?: "button" | "submit";
}) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600,
    fontFamily: font.body, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary: { background: c.green, color: "#fff" },
    secondary: { background: "#fff", color: c.green, border: `1px solid ${c.border3}` },
    danger: { background: c.danger, color: "#fff" },
    ghost: { background: "rgba(31,77,58,.08)", color: c.green },
  };
  return (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled} style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, width = 460 }: {
  title: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,25,.34)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px -20px rgba(20,30,25,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${c.border2}` }}>
          <h3 style={{ margin: 0, fontFamily: font.display, fontSize: 17, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, color: c.muted2, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%", border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "10px 12px",
  fontSize: 13.5, background: "#fff", color: c.ink, outline: "none",
};
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...(props.style as object) }} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...inputStyle, ...(props.style as object) }} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{ ...inputStyle, resize: "vertical", ...(props.style as object) }} />;
}

export function Spinner() {
  return <div style={{ padding: 40, textAlign: "center", color: c.faint, fontSize: 13 }}>Loading…</div>;
}

export function Avatar({ name, bg = c.greenMid, size = 28 }: { name: string; bg?: string; size?: number }) {
  const init = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: size * 0.38, flex: "none" }}>
      {init}
    </div>
  );
}

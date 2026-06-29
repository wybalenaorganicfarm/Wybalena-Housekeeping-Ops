import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { c } from "../theme";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  icon?: string;
}

// 3-dots row menu. Rendered via a portal + fixed positioning so it's never
// clipped by a table/card with overflow:hidden. Outside-click closes it.
export function KebabMenu({ items, disabled }: { items: MenuItem[]; disabled?: boolean }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  function toggle() {
    if (pos) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle} disabled={disabled}
        style={{ background: "none", border: "none", cursor: "pointer", color: c.muted2, padding: 4, opacity: disabled ? 0.4 : 1, display: "inline-flex" }}>
        <Icon name="more" size={16} strokeWidth={2} />
      </button>
      {pos && createPortal(
        <>
          <div onClick={() => setPos(null)} style={{ position: "fixed", inset: 0, zIndex: 80 }} />
          <div style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 81, background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, boxShadow: "0 8px 28px rgba(0,0,0,.14)", padding: 4, minWidth: 156 }}>
            {items.map((it, i) => (
              <button key={i} onClick={() => { setPos(null); it.onClick(); }}
                style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: it.danger ? c.danger : c.body, padding: "8px 10px", borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = it.danger ? "#fbeae8" : c.panel)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                <Icon name={it.icon ?? (it.danger ? "trash" : "more")} size={14} strokeWidth={2} />{it.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

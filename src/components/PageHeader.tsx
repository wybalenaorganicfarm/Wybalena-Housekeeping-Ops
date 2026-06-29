import type { CSSProperties, ReactNode } from "react";
import { c, font } from "../theme";

export function PageHeader({ title, subtitle, right, titleStyle }: { title: string; subtitle?: string; right?: ReactNode; titleStyle?: CSSProperties }) {
  return (
    <div style={{ height: 60, flex: "none", borderBottom: `1px solid ${c.border}`, background: c.panel, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px" }}>
      <div>
        <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700, color: c.ink, lineHeight: 1.2, ...titleStyle }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
    </div>
  );
}

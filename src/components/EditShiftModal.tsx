import { useState } from "react";
import { c, font } from "../theme";
import { Icon } from "./Icon";
import { updateShift } from "../lib/api";
import { typeLabel } from "../lib/format";
import type { Shift } from "../lib/types";

const labelStyle = { fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: c.muted2, fontWeight: 600 };
const fieldStyle = { border: `1px solid ${c.border3}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, background: "#fff", color: c.ink, outline: "none", width: "100%" } as const;

export function EditShiftModal({ shift, onClose, onSaved }: { shift: Shift; onClose: () => void; onSaved: () => void }) {
  const [time, setTime] = useState(shift.start_time.slice(0, 5));
  const [hours, setHours] = useState(shift.estimated_hours);
  const [type, setType] = useState(shift.shift_type);
  const [required, setRequired] = useState(shift.required_cleaners);
  const [instr, setInstr] = useState(shift.special_instructions ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const e = await updateShift(shift.id, {
      start_time: time, estimated_hours: hours, shift_type: type as Shift["shift_type"],
      required_cleaners: required, special_instructions: instr || null,
    });
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved(); onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,22,.4)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxHeight: "90vh", background: c.sand, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: "none", padding: "20px 24px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, background: c.sand }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Edit shift</div>
            <h2 style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, margin: 0 }}>{typeLabel(shift)}</h2>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={15} strokeWidth={2} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Start time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={fieldStyle} /></label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Duration (hrs)</span><input type="number" min={1} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} style={fieldStyle} /></label>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Clean type</span>
              <select value={type} onChange={(e) => setType(e.target.value as Shift["shift_type"])} style={fieldStyle}>
                <option value="standard">Standard Clean</option>
                <option value="mid_retreat">Mid-Retreat Clean</option>
                <option value="deep_full_venue">Deep Clean</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Cleaners required</span><input type="number" min={1} value={required} onChange={(e) => setRequired(Number(e.target.value))} style={fieldStyle} /></label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Special instructions</span><textarea value={instr} onChange={(e) => setInstr(e.target.value)} style={{ ...fieldStyle, minHeight: 110, resize: "vertical", lineHeight: 1.55, fontSize: 13.5 }} /></label>
          {err && <div style={{ color: c.danger, fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ flex: "none", padding: "16px 24px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

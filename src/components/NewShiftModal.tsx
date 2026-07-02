import { useState } from "react";
import { createShift } from "../lib/api";
import { c, font } from "../theme";
import { Icon } from "./Icon";
import type { Shift, VenueScope } from "../lib/types";

const BUILDINGS = [
  "The Main House",
  "The Yoga Studio",
  "The Banksia Rooms",
  "The Garden Rooms",
  "Cabin 1",
  "Cabin 2",
  "Cabin 3",
  "Cabin 4",
];

const CLEAN_TYPES: [string, string][] = [
  ["standard", "Standard Clean"],
  ["mid_retreat", "Mid-Retreat Clean"],
  ["deep_full_venue", "Deep Clean"],
];

const labelStyle = { fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: c.muted2, fontWeight: 600 };
const fieldStyle = { border: `1px solid ${c.border3}`, borderRadius: 8, padding: "10px 12px", fontSize: 14, background: "#fff", color: c.ink, outline: "none", width: "100%" } as const;

export function NewShiftModal({ onClose, onCreated, onManualAssign }: {
  onClose: () => void; onCreated: () => void; onManualAssign?: (shift: Shift) => void;
}) {
  const [type, setType] = useState("standard");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [hours, setHours] = useState(3);
  const [required, setRequired] = useState(6);
  const [scope, setScope] = useState<VenueScope>("full_venue");
  const [buildings, setBuildings] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleBuilding(b: string) {
    setBuildings((prev) => prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]);
  }

  function buildShift(id: string): Shift {
    return {
      id, booking_id: null, shift_type: type as Shift["shift_type"], shift_date: date,
      start_time: time, estimated_hours: hours, status: "staffing", source: "manual",
      required_cleaners: required, venue_scope: scope, buildings, is_modified: false,
      special_instructions: notes || null, special_instructions_by: null, special_instructions_at: null, current_tier: null,
      confirmed_at: null, cancelled_at: null, created_at: "",
    };
  }

  async function save() {
    if (!date) { setErr("Pick a date"); return; }
    if (scope === "partial_venue" && buildings.length === 0) { setErr("Select at least one building"); return; }
    setBusy(true);
    const res = await createShift({
      shift_type: type, shift_date: date, start_time: time,
      estimated_hours: hours, required_cleaners: required,
      special_instructions: notes || null,
      venue_scope: scope, buildings: scope === "partial_venue" ? buildings : [],
    });
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    onCreated();
    if (mode === "manual" && res.id && onManualAssign) onManualAssign(buildShift(res.id));
    onClose();
  }

  const toggleBtn = (active: boolean) => ({
    flex: 1, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    borderRadius: 8, border: `1px solid ${active ? c.green : c.border3}`,
    background: active ? c.green : "#fff", color: active ? "#fff" : c.body,
  } as const);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,22,.4)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 540, maxHeight: "92vh", background: c.sand, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: "none", padding: "20px 24px 14px", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: c.sand }}>
          <div>
            <div style={labelStyle}>New shift</div>
            <h2 style={{ fontFamily: font.display, fontSize: 21, fontWeight: 700, margin: "6px 0 0" }}>Create a cleaning shift</h2>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, border: `1px solid ${c.border3}`, background: "#fff", borderRadius: 7, color: c.muted2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={15} strokeWidth={2} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Clean type */}
          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Clean type</span>
            <select value={type} onChange={(e) => { setType(e.target.value); setRequired(e.target.value === "deep_full_venue" ? 7 : 6); }} style={fieldStyle}>
              {CLEAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          {/* Venue scope — full by default, partial when individual buildings */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={labelStyle}>Venue</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setScope("full_venue")} style={toggleBtn(scope === "full_venue")}>The Whole Venue</button>
              <button onClick={() => setScope("partial_venue")} style={toggleBtn(scope === "partial_venue")}>Individual buildings</button>
            </div>
            {scope === "partial_venue" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                {BUILDINGS.map((b) => {
                  const on = buildings.includes(b);
                  return (
                    <button key={b} onClick={() => toggleBuilding(b)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 8, border: `1px solid ${on ? c.green : c.border3}`, background: on ? "#eef3ef" : "#fff", color: c.body, fontSize: 13, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                      <span style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid ${on ? c.green : c.border3}`, background: on ? c.green : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
                      {b}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} /></label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Start time</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={fieldStyle} /></label>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Duration (hrs)</span><input type="number" min={1} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} style={fieldStyle} /></label>
            <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Cleaners required</span><input type="number" min={1} value={required} onChange={(e) => setRequired(Number(e.target.value))} style={fieldStyle} /></label>
          </div>

          {/* Notes */}
          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={labelStyle}>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Extra information for the cleaners…" style={{ ...fieldStyle, minHeight: 80, resize: "vertical", lineHeight: 1.5, fontSize: 13.5 }} />
          </label>

          {/* Assignment mode */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={labelStyle}>Assignment</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setMode("auto")} style={toggleBtn(mode === "auto")}>Assign by tiers</button>
              <button onClick={() => setMode("manual")} style={toggleBtn(mode === "manual")}>Assign cleaners</button>
            </div>
            <span style={{ fontSize: 11.5, color: c.faint }}>
              {mode === "auto" ? "Offers go out automatically, Tier 1 first." : "Pick cleaners yourself after creating the shift."}
            </span>
          </div>

          {err && <div style={{ color: c.danger, fontSize: 12.5 }}>{err}</div>}
        </div>

        <div style={{ padding: "14px 24px", borderTop: `1px solid ${c.border}`, background: "#fff", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "#fff", color: c.body, border: `1px solid ${c.border3}`, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ background: c.green, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "Creating…" : mode === "manual" ? "Create & assign" : "Create shift"}</button>
        </div>
      </div>
    </div>
  );
}

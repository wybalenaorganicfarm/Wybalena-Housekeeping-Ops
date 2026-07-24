import { useMemo, useRef, useState, useEffect } from "react";
import { c, font } from "../theme";
import { Icon } from "../components/Icon";
import { Button, Card, Modal, Spinner } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { getMessageTemplates, updateMessageTemplate } from "../lib/api";
import type { MessageTemplate, TemplateButton } from "../lib/types";
import { toastError, toastOk } from "../lib/toast";

// Editable WhatsApp message templates. Admin / Operations Manager only (route is
// canEdit-gated; RLS enforces it server-side). Each template maps to exactly one
// place a cleaner message is sent — editing here changes what goes out, no
// redeploy. {{placeholders}} are filled at send time with live shift values.
//
// Editing happens in a modal (not inline) so the collapsed 2-column grid never
// reflows / leaves dead whitespace when a card is opened.

const SAMPLE: Record<string, string> = {
  shift_date: "2026-07-25",
  start_time: "09:30",
  shift_type: "standard",
};

function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? `{{${k}}}`);
}

// Light *bold* rendering for the preview so it reads like WhatsApp.
function renderRich(text: string) {
  return text.split(/(\*[^*\n]+\*)/g).map((seg, i) =>
    seg.startsWith("*") && seg.endsWith("*") && seg.length > 2
      ? <strong key={i}>{seg.slice(1, -1)}</strong>
      : <span key={i}>{seg}</span>,
  );
}

interface Draft {
  body: string;
  header: string | null;
  footer: string | null;
  fallback: string | null;
  buttons: TemplateButton[] | null;
}

function toDraft(src: { body: string; header: string | null; footer: string | null; fallback: string | null; buttons: TemplateButton[] | null }): Draft {
  return {
    body: src.body,
    header: src.header,
    footer: src.footer,
    fallback: src.fallback,
    buttons: src.buttons ? src.buttons.map((b) => ({ ...b })) : null,
  };
}

function sameButtons(a: TemplateButton[] | null, b: TemplateButton[] | null): boolean {
  if (!a || !b) return a === b || (!a && !b);
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.title === b[i].title);
}

function isCustomised(t: MessageTemplate): boolean {
  const d = t.defaults;
  return t.body !== d.body || (t.header ?? null) !== (d.header ?? null) ||
    (t.footer ?? null) !== (d.footer ?? null) || (t.fallback ?? null) !== (d.fallback ?? null) ||
    !sameButtons(t.buttons, d.buttons);
}

// WhatsApp-style bubble preview of the rendered message.
function Preview({ header, body, footer, buttons }: { header: string | null; body: string; footer: string | null; buttons: TemplateButton[] | null }) {
  const filled = fillVars(body, SAMPLE);
  return (
    <div style={{ background: "#E5DDD5", borderRadius: 10, padding: 14 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", maxWidth: 300, boxShadow: "0 1px 1px rgba(0,0,0,.12)", fontSize: 13, lineHeight: 1.45, color: "#111" }}>
        {header && <div style={{ fontWeight: 700, marginBottom: 4 }}>{fillVars(header, SAMPLE)}</div>}
        <div style={{ whiteSpace: "pre-wrap" }}>{renderRich(filled)}</div>
        {footer && <div style={{ color: "#8a8f92", fontSize: 11, marginTop: 6 }}>{fillVars(footer, SAMPLE)}</div>}
        {buttons && buttons.length > 0 && (
          <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {buttons.map((b, i) => (
              <div key={i} style={{ color: "#0a7cff", fontWeight: 600, fontSize: 12.5, textAlign: "center", padding: "4px 0" }}>{b.title}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", border: `1.5px solid ${c.border3}`, borderRadius: 8, padding: "9px 11px",
  fontSize: 13.5, background: "#fff", color: c.ink, outline: "none", boxSizing: "border-box",
};

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ── Collapsed card (grid cell): display-only, opens the editor modal ──────────
function TemplateCard({ t, onEdit }: { t: MessageTemplate; onEdit: () => void }) {
  const customised = isCustomised(t);
  return (
    <Card style={{ padding: 16, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{t.label}</div>
            {customised && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#5b3fa0", background: "#f2ecfb", borderRadius: 20, padding: "2px 8px" }}>Customised</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3, lineHeight: 1.45 }}>{t.description}</div>
        </div>
        <Button kind="secondary" onClick={onEdit} style={{ flex: "none", padding: "7px 12px", fontSize: 12.5 }}>
          <Icon name="pencil" size={13} strokeWidth={2} /> Edit
        </Button>
      </div>
      <div style={{ marginTop: 12 }}>
        <Preview header={t.header} body={t.body} footer={t.footer} buttons={t.buttons} />
      </div>
    </Card>
  );
}

// ── Editor modal: form on the left, sticky live preview on the right ──────────
function TemplateEditorModal({ t, onClose, onSaved }: { t: MessageTemplate; onClose: () => void; onSaved: (next: MessageTemplate) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(t));
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<number | null>(null); // last caret position in the message box

  const customised = isCustomised(t);
  const hasHeader = t.defaults.header !== null || t.header !== null;
  const hasFooter = t.defaults.footer !== null || t.footer !== null;
  const hasFallback = t.defaults.fallback !== null || t.fallback !== null;

  const dirty = useMemo(() => draft.body !== t.body ||
    (draft.header ?? null) !== (t.header ?? null) || (draft.footer ?? null) !== (t.footer ?? null) ||
    (draft.fallback ?? null) !== (t.fallback ?? null) || !sameButtons(draft.buttons, t.buttons), [draft, t]);

  function resetToDefault() { setDraft(toDraft(t.defaults)); }

  // Insert {{name}} at the last caret position (or the end if never focused).
  function insertVar(name: string) {
    const token = `{{${name}}}`;
    setDraft((d) => {
      const at = cursor.current ?? d.body.length;
      const next = d.body.slice(0, at) + token + d.body.slice(at);
      cursor.current = at + token.length;
      requestAnimationFrame(() => {
        const el = bodyRef.current;
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = cursor.current!; }
      });
      return { ...d, body: next };
    });
  }
  function trackCursor() { const el = bodyRef.current; if (el) cursor.current = el.selectionStart; }

  async function save() {
    setSaving(true);
    const err = await updateMessageTemplate(t.key, {
      body: draft.body, header: draft.header, footer: draft.footer, fallback: draft.fallback, buttons: draft.buttons,
    });
    setSaving(false);
    if (err) { toastError(err); return; }
    toastOk(`“${t.label}” updated.`);
    onSaved({ ...t, ...draft });
    onClose();
  }

  return (
    <Modal title={`Edit — ${t.label}`} width={840} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: c.muted, marginTop: -6, marginBottom: 16, lineHeight: 1.45 }}>{t.description}</div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 24, alignItems: "start" }}>
        {/* Editor column */}
        <div>
          {hasHeader && (
            <EditField label="Header">
              <input value={draft.header ?? ""} onChange={(e) => setDraft((d) => ({ ...d, header: e.target.value }))} style={inputStyle} />
            </EditField>
          )}
          <EditField label="Message">
            <textarea ref={bodyRef} value={draft.body}
              onChange={(e) => { setDraft((d) => ({ ...d, body: e.target.value })); trackCursor(); }}
              onSelect={trackCursor} onKeyUp={trackCursor} onClick={trackCursor} onBlur={trackCursor}
              rows={6} style={{ ...inputStyle, minHeight: 140, resize: "vertical", fontFamily: font.body }} />
          </EditField>

          {t.variables.length > 0 && (
            <div style={{ marginTop: -4, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: c.muted2, marginBottom: 5 }}>Insert a variable — replaced with the real value when sent:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {t.variables.map((v) => (
                  <button key={v.name} type="button" title={v.description} onClick={() => insertVar(v.name)}
                    style={{ border: `1px solid ${c.chipBd}`, background: "#fff", color: c.green, borderRadius: 7, padding: "4px 9px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "monospace" }}>
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasFooter && (
            <EditField label="Footer">
              <input value={draft.footer ?? ""} onChange={(e) => setDraft((d) => ({ ...d, footer: e.target.value }))} style={inputStyle} />
            </EditField>
          )}

          {draft.buttons && draft.buttons.length > 0 && (
            <EditField label="Button labels">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {draft.buttons.map((b, i) => (
                  <input key={b.id} value={b.title} maxLength={20}
                    onChange={(e) => setDraft((d) => ({ ...d, buttons: d.buttons!.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))}
                    style={inputStyle} />
                ))}
              </div>
            </EditField>
          )}

          {hasFallback && (
            <EditField label="Plain-text fallback">
              <textarea value={draft.fallback ?? ""} onChange={(e) => setDraft((d) => ({ ...d, fallback: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: font.body }} />
              <div style={{ fontSize: 11, color: c.muted2, marginTop: 4 }}>Sent instead if the interactive buttons can’t be delivered.</div>
            </EditField>
          )}
        </div>

        {/* Sticky live preview */}
        <div style={{ position: "sticky", top: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 8 }}>Preview</div>
          <Preview header={draft.header} body={draft.body} footer={draft.footer} buttons={draft.buttons} />
          <div style={{ fontSize: 11, color: c.faint, marginTop: 8, lineHeight: 1.45 }}>Sample values shown; real shift details fill in when sent.</div>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${c.border2}` }}>
        <Button onClick={save} loading={saving} disabled={!dirty}>Save changes</Button>
        <Button kind="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={resetToDefault} disabled={saving || !customised}
          title={customised ? "Restore the original wording" : "Already the default"}
          style={{ border: "none", background: "none", color: customised ? c.muted : c.faint, fontSize: 12, fontWeight: 600, cursor: customised ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="refresh" size={12} strokeWidth={2.2} /> Reset to default
        </button>
      </div>
    </Modal>
  );
}

export function Templates() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useEffect(() => { getMessageTemplates().then(setTemplates); }, []);

  const groups = useMemo(() => {
    const map = new Map<string, MessageTemplate[]>();
    for (const t of templates ?? []) {
      const arr = map.get(t.category) ?? [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return [...map.entries()];
  }, [templates]);

  function onSaved(next: MessageTemplate) {
    setTemplates((prev) => (prev ?? []).map((t) => (t.key === next.key ? next : t)));
  }

  if (!templates) return <Spinner />;

  const editing = templates.find((t) => t.key === editingKey) ?? null;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Message Templates" subtitle="Edit the WhatsApp messages cleaners receive" />
      <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px 48px" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 9, marginBottom: 20, padding: "12px 15px", background: c.railGreenBg, border: `1px solid ${c.railGreenBd}`, borderRadius: 10 }}>
            <Icon name="info" size={16} color="#5e7a6a" strokeWidth={1.9} />
            <div style={{ fontSize: 12, color: "#41604f", lineHeight: 1.5 }}>
              Changes take effect on the next message sent — no redeploy needed. Text in <code style={{ fontFamily: "monospace", background: "#fff", padding: "0 4px", borderRadius: 4 }}>{`{{braces}}`}</code> is filled in automatically with the real shift details. Use <strong>Reset to default</strong> to restore the original wording.
            </div>
          </div>

          {groups.map(([category, items]) => (
            <div key={category} style={{ marginBottom: 26 }}>
              <div style={{ fontFamily: font.display, fontSize: 13, fontWeight: 700, color: c.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{category}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, alignItems: "stretch" }}>
                {items.map((t) => <TemplateCard key={t.key} t={t} onEdit={() => setEditingKey(t.key)} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && <TemplateEditorModal t={editing} onClose={() => setEditingKey(null)} onSaved={onSaved} />}
    </div>
  );
}

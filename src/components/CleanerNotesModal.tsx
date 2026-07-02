import { useEffect, useState } from "react";
import { c } from "../theme";
import { Button, Modal, Textarea } from "./ui";
import { addCleanerNote, getCleanerNotes, getProfileNames } from "../lib/api";
import { toastError } from "../lib/toast";
import type { Cleaner, CleanerNote } from "../lib/types";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CleanerNotesModal({ cleaner, onClose }: { cleaner: Cleaner; onClose: () => void }) {
  const [notes, setNotes] = useState<CleanerNote[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const ns = await getCleanerNotes(cleaner.id);
    setNotes(ns);
    setAuthors(await getProfileNames(ns.map((n) => n.author_id).filter(Boolean) as string[]));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [cleaner.id]);

  async function add() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const err = await addCleanerNote(cleaner.id, text);
    setBusy(false);
    if (err) { toastError(err); return; }
    setBody("");
    load();
  }

  return (
    <Modal title={`Notes · ${cleaner.full_name}`} onClose={onClose} width={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note about this cleaner…" style={{ minHeight: 74, lineHeight: 1.5, fontSize: 13.5 }} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={add} disabled={busy || !body.trim()}>{busy ? "Adding…" : "Add note"}</Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto" }}>
        {loading && <div style={{ fontSize: 12.5, color: c.faint, textAlign: "center", padding: 12 }}>Loading…</div>}
        {!loading && notes.length === 0 && <div style={{ fontSize: 12.5, color: c.faint, textAlign: "center", padding: 12 }}>No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} style={{ background: c.sand, border: `1px solid ${c.border}`, borderRadius: 8, padding: "11px 13px" }}>
            <div style={{ fontSize: 13, color: c.body, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.body}</div>
            <div style={{ fontSize: 11, color: c.faint, marginTop: 7 }}>
              {(n.author_id && authors[n.author_id]) || "Unknown"} · {stamp(n.created_at)}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

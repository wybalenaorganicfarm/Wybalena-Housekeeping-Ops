import { useEffect, useState } from "react";
import { c } from "../theme";
import { Button, ConfirmDialog, Modal, Textarea } from "./ui";
import { addCleanerNote, deleteCleanerNote, getCleanerNotes, getProfileNames, updateCleanerNote } from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import type { Cleaner, CleanerNote } from "../lib/types";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// canModify: admin / operations_manager can edit + delete notes (RLS allows it).
// Team leads can only add, so they get no edit/delete controls.
export function CleanerNotesModal({ cleaner, canModify = false, onClose }: {
  cleaner: Cleaner; canModify?: boolean; onClose: () => void;
}) {
  const [notes, setNotes] = useState<CleanerNote[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // The note currently being edited inline, and the live draft of its text.
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // The note queued for deletion (shows the confirm dialog).
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  function startEdit(n: CleanerNote) {
    setEditId(n.id);
    setEditBody(n.body);
  }

  async function saveEdit() {
    const text = editBody.trim();
    if (!text) return;
    setSavingEdit(true);
    const err = await updateCleanerNote(editId!, text);
    setSavingEdit(false);
    if (err) { toastError(err); return; }
    setEditId(null);
    setEditBody("");
    toastOk("Note updated.");
    load();
  }

  async function confirmDelete() {
    setDeleting(true);
    const err = await deleteCleanerNote(deleteId!);
    setDeleting(false);
    if (err) { toastError(err); return; }
    setDeleteId(null);
    toastOk("Note deleted.");
    load();
  }

  const linkBtn: React.CSSProperties = {
    background: "none", border: "none", padding: 0, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  };

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
            {editId === n.id ? (
              // Inline editor for this note.
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} style={{ minHeight: 64, lineHeight: 1.5, fontSize: 13.5 }} />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <Button kind="secondary" onClick={() => { setEditId(null); setEditBody(""); }} disabled={savingEdit}>Cancel</Button>
                  <Button onClick={saveEdit} loading={savingEdit} disabled={!editBody.trim()}>Save</Button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: c.body, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.body}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 7 }}>
                  <div style={{ fontSize: 11, color: c.faint }}>
                    {(n.author_id && authors[n.author_id]) || "Unknown"} · {stamp(n.created_at)}
                  </div>
                  {canModify && (
                    <div style={{ display: "flex", gap: 12, flex: "none" }}>
                      <button style={{ ...linkBtn, color: c.muted2 }} onClick={() => startEdit(n)}>Edit</button>
                      <button style={{ ...linkBtn, color: c.danger }} onClick={() => setDeleteId(n.id)}>Delete</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete note"
          message="Delete this note? This can't be undone."
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </Modal>
  );
}

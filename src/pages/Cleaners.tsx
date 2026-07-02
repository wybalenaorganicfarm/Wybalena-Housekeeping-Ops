import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { c, font, TIER_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Avatar, Button, ConfirmDialog, Field, Input, Modal, Spin, Spinner } from "../components/ui";
import { KebabMenu } from "../components/KebabMenu";
import { CleanerNotesModal } from "../components/CleanerNotesModal";
import { PhoneInput, countryName, toE164 } from "../components/PhoneInput";
import { parsePhoneNumber, type CountryCode } from "libphonenumber-js";
import { PageHeader } from "../components/PageHeader";
import { addCleaner, getCleaners, getReliability, removeCleaner, setCleanerStatus, updateCleaner } from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import { acceptRate, monthYear } from "../lib/format";
import type { Cleaner, CleanerReliability, CleanerStatus, CleanerTier } from "../lib/types";

const TIER_SUB: Record<CleanerTier, string> = {
  tier_1: "first to be offered",
  tier_2: "offered after 24h",
  tier_3: "last-resort backup",
};

function rateColor(r: number | null): string {
  if (r === null) return "#8a8478";
  if (r >= 80) return "#2c6446";
  if (r >= 60) return "#9a7320";
  return "#a8392b";
}

function AddCleanerModal({ existing, onClose, onSaved }: { existing: Cleaner[]; onClose: () => void; onSaved: () => void }) {
  const [full_name, setName] = useState("");
  const [country, setCountry] = useState<CountryCode>("AU");
  const [national, setNational] = useState("");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<CleanerTier>("tier_1");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!full_name.trim()) { setErr("Name is required"); return; }

    // a. Valid phone for the selected country (libphonenumber enforces the
    //    correct length per country, e.g. 10 digits for India / mobile AU).
    const e164 = toE164(country, national);
    if (!e164) { setErr(`Enter a valid phone number for ${countryName(country)}`); return; }

    const emailNorm = email.trim().toLowerCase();
    if (emailNorm && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) {
      setErr("Enter a valid email address"); return;
    }

    // b. Phone / email must not already exist in the cleaners table.
    const phoneDigits = e164.replace(/\D/g, "");
    const dupPhone = existing.find((x) => x.phone.replace(/\D/g, "") === phoneDigits);
    if (dupPhone) { setErr(`That phone number is already used by ${dupPhone.full_name}`); return; }
    if (emailNorm) {
      const dupEmail = existing.find((x) => (x.email ?? "").trim().toLowerCase() === emailNorm);
      if (dupEmail) { setErr(`That email is already used by ${dupEmail.full_name}`); return; }
    }

    setBusy(true);
    const e = await addCleaner({ full_name: full_name.trim(), phone: e164, email: emailNorm || undefined, tier });
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved(); onClose();
  }

  const tiers: [CleanerTier, string][] = [["tier_1", "First to be offered"], ["tier_2", "After 24 hours"], ["tier_3", "Last-resort backup"]];

  return (
    <Modal title="New cleaner profile" onClose={onClose}>
      <Field label={<>Full name <span style={{ color: c.danger }}>*</span></>}><Input value={full_name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah Johnson" /></Field>
      <Field label={<>Phone <span style={{ color: c.danger }}>*</span></>}>
        <PhoneInput country={country} national={national} onCountry={setCountry} onNational={setNational} />
      </Field>
      <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@email.com" /></Field>
      <div style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted2, fontWeight: 600, marginBottom: 10 }}>Tier</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {tiers.map(([t, sub]) => {
          const on = tier === t;
          return (
            <button key={t} onClick={() => setTier(t)} style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 9, background: "#fff", border: `1.5px solid ${on ? c.green : c.border3}`, borderRadius: 8, padding: "11px 12px", cursor: "pointer" }}>
              <span style={{ width: 14, height: 14, flex: "none", borderRadius: "50%", border: `2px solid ${on ? c.green : c.border3}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {on && <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.green }} />}
              </span>
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{TIER_LABEL[t]}</span>
                <span style={{ display: "block", fontSize: 11, color: c.muted2 }}>{sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      {err && <div style={{ color: c.danger, fontSize: 12.5, margin: "10px 0 0" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Add cleaner"}</Button>
      </div>
    </Modal>
  );
}

// Edit a cleaner's contact details (phone + email) — e.g. number changed, or the
// email wasn't known at creation. Prefills phone by parsing the stored E.164.
function EditCleanerModal({ cleaner, existing, onClose, onSaved }: { cleaner: Cleaner; existing: Cleaner[]; onClose: () => void; onSaved: () => void }) {
  const parsed = (() => { try { return parsePhoneNumber(cleaner.phone); } catch { return null; } })();
  const [country, setCountry] = useState<CountryCode>((parsed?.country as CountryCode) ?? "AU");
  const [national, setNational] = useState(parsed?.nationalNumber ? String(parsed.nationalNumber) : "");
  const [email, setEmail] = useState(cleaner.email ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const e164 = toE164(country, national);
    if (!e164) { setErr(`Enter a valid phone number for ${countryName(country)}`); return; }
    const emailNorm = email.trim().toLowerCase();
    if (emailNorm && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) { setErr("Enter a valid email address"); return; }

    const phoneDigits = e164.replace(/\D/g, "");
    const dupPhone = existing.find((x) => x.id !== cleaner.id && x.phone.replace(/\D/g, "") === phoneDigits);
    if (dupPhone) { setErr(`That phone number is already used by ${dupPhone.full_name}`); return; }
    if (emailNorm) {
      const dupEmail = existing.find((x) => x.id !== cleaner.id && (x.email ?? "").trim().toLowerCase() === emailNorm);
      if (dupEmail) { setErr(`That email is already used by ${dupEmail.full_name}`); return; }
    }

    setBusy(true);
    const e = await updateCleaner(cleaner.id, { phone: e164, email: emailNorm || null });
    setBusy(false);
    if (e) { setErr(e); return; }
    onSaved(); onClose();
  }

  return (
    <Modal title={`Edit ${cleaner.full_name}`} onClose={onClose}>
      <Field label={<>Phone <span style={{ color: c.danger }}>*</span></>}>
        <PhoneInput country={country} national={national} onCountry={setCountry} onNational={setNational} />
      </Field>
      <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@email.com" /></Field>
      {err && <div style={{ color: c.danger, fontSize: 12.5, margin: "10px 0 0" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>
    </Modal>
  );
}

const CLEANER_STATUS_META: Record<CleanerStatus, { label: string; color: string; dot: string }> = {
  active: { label: "Active", color: "#2c6446", dot: "#3D8B5F" },
  away: { label: "Away", color: "#21564b", dot: "#2f7068" },
  inactive: { label: "Inactive", color: "#8a8478", dot: "#c4bdb0" },
};

const COL = { phone: 120, email: 180, status: 116, rel: 168, rate: 84, action: 40 };

export function Cleaners() {
  const { canEdit, isTeamLead } = useAuth();
  const canManage = canEdit || isTeamLead; // status + notes; add/remove stays admin-only
  const navigate = useNavigate();
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [rel, setRel] = useState<Record<string, CleanerReliability>>({});
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  const [removing, setRemoving] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Cleaner | null>(null);
  const [notesFor, setNotesFor] = useState<Cleaner | null>(null);
  const [editing, setEditing] = useState<Cleaner | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function load() {
    const [cs, r] = await Promise.all([getCleaners(), getReliability()]);
    setCleaners(cs); setRel(r); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function changeStatus(cl: Cleaner, status: CleanerStatus) {
    const prevStatus = cl.status, prevActive = cl.is_active;
    // Optimistic: reflect immediately, then persist; revert on failure.
    setCleaners((prev) => prev.map((x) => x.id === cl.id ? { ...x, status, is_active: status === "active" } : x));
    setSaving((s) => ({ ...s, [cl.id]: true }));
    const { error } = await setCleanerStatus(cl.id, status);
    setSaving((s) => ({ ...s, [cl.id]: false }));
    if (error) {
      toastError(error);
      setCleaners((prev) => prev.map((x) => x.id === cl.id ? { ...x, status: prevStatus, is_active: prevActive } : x));
    }
  }

  async function remove(cl: Cleaner) {
    setRemoving(cl.id);
    const { data, error } = await removeCleaner(cl.id);
    setRemoving(null);
    setToRemove(null);
    if (error) { toastError(error); return; }
    await load();
    const where = data?.mode === "deactivated" ? "deactivated (kept for shift history)" : "removed";
    toastOk(`${cl.full_name} ${where}.${data?.emailed ? " Email notification sent." : cl.email ? "" : " No email on file — not notified."}`);
  }

  const counts = useMemo(() => ({
    all: cleaners.length,
    tier_1: cleaners.filter((c) => c.tier === "tier_1").length,
    tier_2: cleaners.filter((c) => c.tier === "tier_2").length,
    tier_3: cleaners.filter((c) => c.tier === "tier_3").length,
  }), [cleaners]);

  const activeCount = cleaners.filter((c) => c.is_active).length;

  const chips: [string, string, string?][] = [
    ["all", "All tiers"], ["tier_1", "Tier 1", c.greenMid], ["tier_2", "Tier 2", c.warn], ["tier_3", "Tier 3", c.danger],
  ];

  if (loading) return <Spinner />;

  const shown = (["tier_1", "tier_2", "tier_3"] as CleanerTier[]).filter((t) => tierFilter === "all" || tierFilter === t);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="Cleaners" subtitle={`${activeCount} active`}
        right={canEdit ? (
          <>
            <Button kind="secondary"><Icon name="search" size={14} strokeWidth={2.2} /> Search</Button>
            <Button onClick={() => setShowAdd(true)}><Icon name="plus" size={14} strokeWidth={2.2} /> Add cleaner</Button>
          </>
        ) : undefined} />

      <div style={{ flex: "none", borderBottom: `1px solid ${c.border}`, background: "#fff", display: "flex", alignItems: "center", gap: 7, padding: "10px 24px" }}>
        {chips.map(([k, l, dot]) => {
          const on = tierFilter === k;
          return (
            <span key={k} onClick={() => setTierFilter(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>
              {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />}
              {l} <span style={{ opacity: 0.8 }}>{counts[k as keyof typeof counts]}</span>
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: c.faint }}>Sorted by tier, then reliability</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 18px", height: 38, background: c.tableHead, borderBottom: `1px solid ${c.border}`, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>
            <div style={{ flex: 1 }}>Cleaner</div>
            <div style={{ flex: "none", width: COL.phone }}>Phone</div>
            <div style={{ flex: "none", width: COL.email }}>Email</div>
            <div style={{ flex: "none", width: COL.status }}>Status</div>
            <div style={{ flex: "none", width: COL.rel }}>Reliability</div>
            <div style={{ flex: "none", width: COL.rate, textAlign: "right" }}>Accept rate</div>
            {canManage && <div style={{ flex: "none", width: COL.action }} />}
          </div>

          {shown.map((t) => {
            const inTier = cleaners.filter((cl) => cl.tier === t).sort((a, b) =>
              (acceptRate(rel[b.id]?.accepted_count ?? 0, rel[b.id]?.declined_count ?? 0, rel[b.id]?.cancelled_count ?? 0) ?? -1) -
              (acceptRate(rel[a.id]?.accepted_count ?? 0, rel[a.id]?.declined_count ?? 0, rel[a.id]?.cancelled_count ?? 0) ?? -1));
            if (!inTier.length) return null;
            return (
              <div key={t}>
                <div style={{ padding: "7px 18px", background: c.sectionBg, borderTop: t !== shown[0] ? `1px solid ${c.sectionBd}` : "none", borderBottom: `1px solid ${c.sectionBd}` }}>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "#2c6446", fontWeight: 700 }}>{TIER_LABEL[t]} · {TIER_SUB[t]}</span>
                </div>
                {inTier.map((cl) => {
                  const r = rel[cl.id];
                  const acc = r?.accepted_count ?? 0, dec = r?.declined_count ?? 0, can = r?.cancelled_count ?? 0;
                  const rate = acceptRate(acc, dec, can);
                  const col = rateColor(rate);
                  const avBg = cl.is_team_leader ? c.green : cl.tier === "tier_1" ? c.greenMid : cl.tier === "tier_2" ? c.warn : "#c4bdb0";
                  return (
                    <div key={cl.id} style={{ display: "flex", alignItems: "center", padding: "11px 18px", borderBottom: `1px solid ${c.rowBd}`, opacity: cl.status === "inactive" ? 0.6 : 1 }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
                        <Avatar name={cl.full_name} size={32} bg={avBg} />
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                            {cl.full_name}
                            {cl.is_team_leader && <span style={{ fontSize: 10, color: "#9a7320", background: "#FBF1DF", padding: "0 6px", borderRadius: 4, fontWeight: 600, marginLeft: 6 }}>Team Lead</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: c.faint }}>Joined {monthYear(cl.created_at)}</div>
                        </div>
                      </div>
                      <div style={{ flex: "none", width: COL.phone, fontSize: 12, color: "#5d665f" }}>{cl.phone}</div>
                      <div style={{ flex: "none", width: COL.email, fontSize: 12, color: "#5d665f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cl.email || "—"}</div>
                      <div style={{ flex: "none", width: COL.status, display: "flex", alignItems: "center", gap: 6 }}>
                        {canManage ? (
                          <>
                          <select value={cl.status} disabled={saving[cl.id]} onChange={(e) => changeStatus(cl, e.target.value as CleanerStatus)} style={{ fontSize: 11.5, fontWeight: 600, color: CLEANER_STATUS_META[cl.status].color, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "3px 7px", background: "#fff", cursor: saving[cl.id] ? "wait" : "pointer", outline: "none" }}>
                            <option value="active">Active</option>
                            <option value="away">Away</option>
                            <option value="inactive">Inactive</option>
                          </select>
                          {saving[cl.id] && <Spin size={13} color={c.muted2} />}
                          </>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: CLEANER_STATUS_META[cl.status].color, fontWeight: 600 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: CLEANER_STATUS_META[cl.status].dot }} />{CLEANER_STATUS_META[cl.status].label}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: "none", width: COL.rel, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 5, borderRadius: 3, background: "#eceadf", overflow: "hidden" }}>
                          <div style={{ width: `${rate ?? 0}%`, height: "100%", background: col }} />
                        </div>
                        <span style={{ fontSize: 11, color: c.muted2, whiteSpace: "nowrap" }}>{acc}✓ {dec}✕</span>
                      </div>
                      <div style={{ flex: "none", width: COL.rate, textAlign: "right", fontSize: 13, fontWeight: 600, color: col }}>{rate === null ? "—" : `${rate}%`}</div>
                      {canManage && (
                        <div style={{ flex: "none", width: COL.action, textAlign: "right" }}>
                          <KebabMenu disabled={removing === cl.id} items={[
                            // Edit (contact details) + remove are admin-only; team leads get notes + status only.
                            ...(canEdit ? [{ label: "Edit", icon: "pencil", onClick: () => setEditing(cl) }] : []),
                            { label: "Notes", icon: "book", onClick: () => setNotesFor(cl) },
                            ...(canEdit
                              ? [cl.is_team_leader
                                  ? { label: "Remove in User management", icon: "users", onClick: () => navigate("/users") }
                                  : { label: "Remove cleaner", danger: true, onClick: () => setToRemove(cl) }]
                              : []),
                          ]} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {cleaners.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No cleaners yet.</div>}
        </div>
      </div>

      {showAdd && <AddCleanerModal existing={cleaners} onClose={() => setShowAdd(false)} onSaved={load} />}
      {editing && <EditCleanerModal cleaner={editing} existing={cleaners} onClose={() => setEditing(null)} onSaved={load} />}
      {notesFor && <CleanerNotesModal cleaner={notesFor} onClose={() => setNotesFor(null)} />}
      {toRemove && (
        <ConfirmDialog
          title="Remove cleaner"
          message={<>Remove <b>{toRemove.full_name}</b> from the roster? They will be notified by email.</>}
          confirmLabel="Remove cleaner"
          danger
          busy={removing === toRemove.id}
          onCancel={() => setToRemove(null)}
          onConfirm={() => remove(toRemove)}
        />
      )}
    </div>
  );
}

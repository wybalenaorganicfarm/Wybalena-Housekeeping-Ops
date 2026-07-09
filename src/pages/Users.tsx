import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { c, ROLE_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Avatar, Button, ConfirmDialog, Field, Input, Modal, Select, Spin, Spinner } from "../components/ui";
import { KebabMenu } from "../components/KebabMenu";
import { PhoneInput, countryName, fromE164, toE164 } from "../components/PhoneInput";
import { PageHeader } from "../components/PageHeader";
import { getUsers, provisionUser, removeUser, setUserPhone, setUserRole, setUserStatus } from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import { lastActiveLabel } from "../lib/format";
import type { CountryCode } from "libphonenumber-js";
import type { Profile, UserRole, UserStatus } from "../lib/types";

const ROLE_BADGE: Record<UserRole, { bg: string; fg: string; dot: string; shield?: boolean }> = {
  super_admin: { bg: "#eaeeec", fg: "#1F4D3A", dot: "#1F4D3A", shield: true },
  admin: { bg: "#E2EFE5", fg: "#2c6446", dot: "#3D8B5F" },
  operations_manager: { bg: "#e4eef5", fg: "#2f6fb0", dot: "#2f6fb0" },
  team_leader: { bg: "#FBF1DF", fg: "#9a7320", dot: "#C8821A" },
};

const STATUS_META: Record<UserStatus, { label: string; color: string; dot: string }> = {
  invite_sent: { label: "Invite sent", color: "#9a7320", dot: "#C8821A" },
  active: { label: "Active", color: "#2c6446", dot: "#3D8B5F" },
  away: { label: "Away", color: "#21564b", dot: "#2f7068" },
  inactive: { label: "Inactive", color: c.muted2, dot: "#c4bdb0" },
};

const ROLE_CARDS: { role: UserRole; desc: string }[] = [
  { role: "admin", desc: "Full access — all operations plus user management, schedule and system logs." },
  { role: "operations_manager", desc: "Full access, same as Admin — and receives all system emails (confirmations, reminders, alerts)." },
  { role: "team_leader", desc: "Read-only view. Can set cleaner status and add cleaner notes; no Users, Schedule or Logs." },
];

// Roles assignable from the UI (super_admin is legacy/hard-coded and not shown).
const ASSIGNABLE_ROLES: UserRole[] = ["admin", "operations_manager", "team_leader"];
// For your OWN row, only the full-access roles — so you can't demote yourself to
// Team Lead and lose access to this page.
const SELF_ROLES: UserRole[] = ["admin", "operations_manager"];

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [full_name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");
  const [country, setCountry] = useState<CountryCode>("AU");
  const [national, setNational] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!email.trim()) { setErr("Email is required"); return; }
    // Phone is required for a team leader (manager summary) and optional for other
    // roles — but if entered, it must be valid. It's used for WhatsApp system alerts.
    let phone: string | undefined;
    const hasNumber = national.trim().length > 0;
    if (role === "team_leader" || hasNumber) {
      const e164 = toE164(country, national);
      if (!e164) {
        setErr(role === "team_leader"
          ? `Enter a valid phone number for ${countryName(country)} (required for a team leader)`
          : `Enter a valid phone number for ${countryName(country)}`);
        return;
      }
      phone = e164;
    }
    setBusy(true);
    const { error } = await provisionUser({ email: email.trim(), full_name, role, phone, redirectTo: window.location.origin });
    setBusy(false);
    if (error) { setErr(error); return; }
    onSaved(); onClose();
  }
  return (
    <Modal title="Invite new user" onClose={onClose}>
      <Field label={<>Full name <span style={{ color: c.danger }}>*</span></>}><Input value={full_name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah Johnson" /></Field>
      <Field label={<>Email <span style={{ color: c.danger }}>*</span></>}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" /></Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">Admin</option>
          <option value="operations_manager">Operations Manager</option>
          <option value="team_leader">Team Leader</option>
        </Select>
      </Field>
      <Field label={role === "team_leader"
        ? <>Phone <span style={{ color: c.danger }}>*</span></>
        : <>Phone <span style={{ color: c.faint, fontWeight: 400 }}>(optional — for WhatsApp alerts)</span></>}>
        <PhoneInput country={country} national={national} onCountry={setCountry} onNational={setNational} />
      </Field>
      <div style={{ fontSize: 11.5, color: c.faint, background: c.panel, border: `1px solid ${c.border}`, borderRadius: 7, padding: "10px 12px", lineHeight: 1.5 }}>
        <strong style={{ color: c.body2 }}>Note:</strong> An invitation email is sent to this address. The user sets their own password and can only sign in after accepting.
      </div>
      {err && <div style={{ color: c.danger, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Sending…" : "Send invite"}</Button>
      </div>
    </Modal>
  );
}

function EditPhoneModal({ user, onClose, onSaved }: { user: Profile; onClose: () => void; onSaved: () => void }) {
  const parsed = user.phone ? fromE164(user.phone) : null;
  const [country, setCountry] = useState<CountryCode>(parsed?.country ?? "AU");
  const [national, setNational] = useState(parsed?.national ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    let phone: string | null = null;
    if (national.trim()) {
      const e164 = toE164(country, national);
      if (!e164) { setErr(`Enter a valid phone number for ${countryName(country)}`); return; }
      phone = e164;
    } else if (user.role === "team_leader") {
      setErr("A team leader must have a phone number."); return;
    }
    setBusy(true);
    const error = await setUserPhone(user.id, phone);
    setBusy(false);
    if (error) { setErr(error); return; }
    toastOk(`Phone ${phone ? "updated" : "removed"} for ${user.full_name || user.email}.`);
    onSaved(); onClose();
  }

  return (
    <Modal title="Edit phone number" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: c.muted, marginBottom: 14 }}>{user.full_name || user.email}</div>
      <Field label={user.role === "team_leader" ? <>Phone <span style={{ color: c.danger }}>*</span></> : "Phone"}>
        <PhoneInput country={country} national={national} onCountry={setCountry} onNational={setNational} />
      </Field>
      <div style={{ fontSize: 11.5, color: c.faint, background: c.panel, border: `1px solid ${c.border}`, borderRadius: 7, padding: "10px 12px", lineHeight: 1.5 }}>
        Used for WhatsApp system alerts (e.g. when email is unavailable).{user.role !== "team_leader" && " Leave blank to remove."}
      </div>
      {err && <div style={{ color: c.danger, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

export function Users() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("all");
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Profile | null>(null);
  const [editPhone, setEditPhone] = useState<Profile | null>(null);

  async function load() { setUsers(await getUsers()); setLoading(false); }
  useEffect(() => { load(); }, []);

  async function remove(u: Profile) {
    setRemoving(u.id);
    const { data, error } = await removeUser(u.id);
    setRemoving(null);
    setToRemove(null);
    if (error) { toastError(error); return; }
    await load();
    toastOk(`${u.full_name || u.email} removed.${data?.emailed ? " Email notification sent." : ""}`);
  }

  async function changeStatus(u: Profile, status: UserStatus) {
    const prev = u.status, prevActive = u.is_active;
    setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status, is_active: status !== "inactive" } : x));
    setSaving((s) => ({ ...s, [u.id]: true }));
    const err = await setUserStatus(u.id, status);
    setSaving((s) => ({ ...s, [u.id]: false }));
    if (err) { toastError(err); setUsers((us) => us.map((x) => x.id === u.id ? { ...x, status: prev, is_active: prevActive } : x)); }
  }

  async function changeRole(u: Profile, role: UserRole) {
    const prev = u.role;
    setUsers((us) => us.map((x) => x.id === u.id ? { ...x, role } : x));
    setSaving((s) => ({ ...s, [u.id]: true }));
    const err = await setUserRole(u.id, role);
    setSaving((s) => ({ ...s, [u.id]: false }));
    if (err) { toastError(err); setUsers((us) => us.map((x) => x.id === u.id ? { ...x, role: prev } : x)); return; }
    toastOk(`${u.full_name || u.email} is now ${ROLE_LABEL[role]}.`);
  }

  const counts = useMemo(() => ({
    all: users.length,
    admin: users.filter((u) => u.role === "admin").length,
    operations_manager: users.filter((u) => u.role === "operations_manager").length,
    team_leader: users.filter((u) => u.role === "team_leader").length,
  }), [users]);

  const filtered = useMemo(() => users.filter((u) =>
    (roleFilter === "all" || u.role === roleFilter) &&
    ((u.full_name ?? "") + u.email).toLowerCase().includes(q.toLowerCase())
  ), [users, roleFilter, q]);

  const chips: [string, string, string?][] = [
    ["all", "All roles"], ["admin", "Admin", "#3D8B5F"], ["operations_manager", "Operations Manager", "#2f6fb0"], ["team_leader", "Team Leader", "#C8821A"],
  ];

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="User management" subtitle={`${users.length} users`}
        right={<Button onClick={() => setShowAdd(true)}><Icon name="plus" size={14} strokeWidth={2.2} /> Add user</Button>} />

      <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px 40px" }}>
        {/* filters */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {chips.map(([k, l, dot]) => {
              const on = roleFilter === k;
              return (
                <span key={k} onClick={() => setRoleFilter(k)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: on ? c.green : "#fff", color: on ? "#fff" : "#5d665f", border: on ? "none" : `1px solid ${c.chipBd}`, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, cursor: "pointer" }}>
                  {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />}
                  {l} <span style={{ opacity: 0.8 }}>{counts[k as keyof typeof counts]}</span>
                </span>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${c.border3}`, borderRadius: 7, padding: "7px 11px", width: 240 }}>
            <Icon name="search" size={15} color={c.faint} strokeWidth={1.8} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users by name or email" style={{ border: "none", outline: "none", background: "none", fontSize: 12.5, color: c.ink, width: "100%" }} />
          </div>
        </div>

        {/* role cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginBottom: 24 }}>
          {ROLE_CARDS.map(({ role, desc }) => {
            const b = ROLE_BADGE[role];
            return (
              <div key={role} style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: b.dot }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: b.fg, fontWeight: 700 }}>{ROLE_LABEL[role]}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#5d665f", lineHeight: 1.5 }}>{desc}</div>
              </div>
            );
          })}
        </div>

        {/* user table */}
        <div style={{ background: "#fff", border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 18px", height: 38, background: c.tableHead, borderBottom: `1px solid ${c.border}`, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted2, fontWeight: 600 }}>
            <div style={{ flex: 1 }}>User</div>
            <div style={{ flex: "none", width: 180 }}>Role</div>
            <div style={{ flex: "none", width: 120 }}>Status</div>
            <div style={{ flex: "none", width: 130 }}>Last active</div>
            <div style={{ flex: "none", width: 40 }} />
          </div>
          {filtered.map((u) => {
            const b = ROLE_BADGE[u.role];
            const isYou = u.id === profile?.id;
            const live = u.status === "active" || u.status === "away";
            const avBg = u.role === "admin" ? c.greenMid : live ? c.warn : "#c4bdb0";
            return (
              <div key={u.id} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${c.rowBd}`, opacity: live ? 1 : 0.72 }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
                  <Avatar name={u.full_name || u.email} size={32} bg={avBg} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{u.full_name || "—"}</div>
                    <div style={{ fontSize: 11.5, color: c.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                    <div style={{ fontSize: 11, color: u.phone ? c.muted2 : "#c4bdb0" }}>{u.phone || "No phone"}</div>
                  </div>
                </div>
                <div style={{ flex: "none", width: 180, display: "flex", alignItems: "center", gap: 6 }}>
                  {u.role === "super_admin" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: b.bg, color: b.fg, fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>
                      {b.shield && <Icon name="shield" size={11} strokeWidth={2} />}{ROLE_LABEL[u.role]}
                    </span>
                  ) : (
                    <>
                    <select value={u.role} disabled={saving[u.id]} onChange={(e) => changeRole(u, e.target.value as UserRole)} style={{ fontSize: 11.5, fontWeight: 600, color: b.fg, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "3px 7px", background: "#fff", cursor: saving[u.id] ? "wait" : "pointer", outline: "none" }}>
                      {(isYou ? SELF_ROLES : ASSIGNABLE_ROLES).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    {saving[u.id] && <Spin size={13} color={c.muted2} />}
                    </>
                  )}
                </div>
                <div style={{ flex: "none", width: 120 }}>
                  {u.status === "invite_sent" || isYou ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: STATUS_META[u.status].color, fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_META[u.status].dot }} />{STATUS_META[u.status].label}
                    </span>
                  ) : (
                    <select value={u.status} disabled={saving[u.id]} onChange={(e) => changeStatus(u, e.target.value as UserStatus)} style={{ fontSize: 11.5, fontWeight: 600, color: STATUS_META[u.status].color, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "3px 7px", background: "#fff", cursor: saving[u.id] ? "wait" : "pointer", outline: "none" }}>
                      <option value="active">Active</option>
                      <option value="away">Away</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  )}
                </div>
                <div style={{ flex: "none", width: 130, fontSize: 12, color: c.muted2 }}>{lastActiveLabel(u.updated_at)}</div>
                <div style={{ flex: "none", width: 40, textAlign: "right", color: c.faint }}>
                  <KebabMenu disabled={removing === u.id} items={[
                    { label: "Edit phone", onClick: () => setEditPhone(u) },
                    ...(isYou ? [] : [{ label: "Remove user", danger: true, onClick: () => setToRemove(u) }]),
                  ]} />
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No users.</div>}
        </div>

      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {editPhone && <EditPhoneModal user={editPhone} onClose={() => setEditPhone(null)} onSaved={load} />}
      {toRemove && (
        <ConfirmDialog
          title="Remove user"
          message={<>Remove <b>{toRemove.full_name || toRemove.email}</b>? They'll lose access and be notified by email.</>}
          confirmLabel="Remove user"
          danger
          busy={removing === toRemove.id}
          onCancel={() => setToRemove(null)}
          onConfirm={() => remove(toRemove)}
        />
      )}
    </div>
  );
}

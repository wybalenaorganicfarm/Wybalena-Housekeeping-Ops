import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { c, ROLE_LABEL } from "../theme";
import { Icon } from "../components/Icon";
import { Avatar, Button, ConfirmDialog, Field, Input, Modal, Select, Spinner } from "../components/ui";
import { KebabMenu } from "../components/KebabMenu";
import { PhoneInput, countryName, toE164 } from "../components/PhoneInput";
import { PageHeader } from "../components/PageHeader";
import { getUsers, provisionUser, removeUser, setCleanerStatusByEmail, setUserStatus } from "../lib/api";
import { toastError, toastOk } from "../lib/toast";
import { lastActiveLabel } from "../lib/format";
import type { CountryCode } from "libphonenumber-js";
import type { Profile, UserRole, UserStatus } from "../lib/types";

const ROLE_BADGE: Record<UserRole, { bg: string; fg: string; dot: string; shield?: boolean }> = {
  super_admin: { bg: "#eaeeec", fg: "#1F4D3A", dot: "#1F4D3A", shield: true },
  admin: { bg: "#E2EFE5", fg: "#2c6446", dot: "#3D8B5F" },
  team_leader: { bg: "#FBF1DF", fg: "#9a7320", dot: "#C8821A" },
};

const STATUS_META: Record<UserStatus, { label: string; color: string; dot: string }> = {
  invite_sent: { label: "Invite sent", color: "#9a7320", dot: "#C8821A" },
  active: { label: "Active", color: "#2c6446", dot: "#3D8B5F" },
  away: { label: "Away", color: "#21564b", dot: "#2f7068" },
  inactive: { label: "Inactive", color: c.muted2, dot: "#c4bdb0" },
};

const ROLE_CARDS: { role: UserRole; desc: string }[] = [
  { role: "super_admin", desc: "Full access plus user management. Hard-coded — the constant who provisions everyone." },
  { role: "admin", desc: "Full operational edit — confirm, create, override, handle reviews. Receives all alerts." },
  { role: "team_leader", desc: "Read-only operational view. Monitors shift status and assignments on-site." },
];

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
    let phone: string | undefined;
    if (role === "team_leader") {
      // A team leader is also added to the cleaners roster, which needs a phone.
      const e164 = toE164(country, national);
      if (!e164) { setErr(`Enter a valid phone number for ${countryName(country)} (required for a team leader)`); return; }
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
          <option value="team_leader">Team Leader</option>
        </Select>
      </Field>
      {role === "team_leader" && (
        <Field label={<>Phone <span style={{ color: c.danger }}>*</span></>}>
          <PhoneInput country={country} national={national} onCountry={setCountry} onNational={setNational} />
        </Field>
      )}
      <div style={{ fontSize: 11.5, color: c.faint, background: c.panel, border: `1px solid ${c.border}`, borderRadius: 7, padding: "10px 12px", lineHeight: 1.5 }}>
        <strong style={{ color: c.body2 }}>Note:</strong> An invitation email is sent to this address. The user sets their own password and can only sign in after accepting. A team leader is also added to the cleaners roster (Tier 1). Super Admin is hard-coded and cannot be assigned here.
      </div>
      {err && <div style={{ color: c.danger, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? "Sending…" : "Send invite"}</Button>
      </div>
    </Modal>
  );
}

export function Users() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState("all");
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Profile | null>(null);

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
    const err = await setUserStatus(u.id, status);
    if (err) { toastError(err); return; }
    // Two-way sync: a team leader is also a cleaner — mirror the status.
    if (u.role === "team_leader" && u.email) await setCleanerStatusByEmail(u.email, status);
    setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, status, is_active: status !== "inactive" } : x));
  }

  const counts = useMemo(() => ({
    all: users.length,
    super_admin: users.filter((u) => u.role === "super_admin").length,
    admin: users.filter((u) => u.role === "admin").length,
    team_leader: users.filter((u) => u.role === "team_leader").length,
  }), [users]);

  const filtered = useMemo(() => users.filter((u) =>
    (roleFilter === "all" || u.role === roleFilter) &&
    ((u.full_name ?? "") + u.email).toLowerCase().includes(q.toLowerCase())
  ), [users, roleFilter, q]);

  const chips: [string, string, string?][] = [
    ["all", "All roles"], ["super_admin", "Super Admin", "#1F4D3A"], ["admin", "Admin", "#3D8B5F"], ["team_leader", "Team Leader", "#C8821A"],
  ];

  if (loading) return <Spinner />;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <PageHeader title="User management" subtitle={`${users.length} users · Super Admin access`}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
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
            <div style={{ flex: "none", width: 140 }}>Role</div>
            <div style={{ flex: "none", width: 120 }}>Status</div>
            <div style={{ flex: "none", width: 130 }}>Last active</div>
            <div style={{ flex: "none", width: 40 }} />
          </div>
          {filtered.map((u) => {
            const b = ROLE_BADGE[u.role];
            const isYou = u.id === profile?.id;
            const live = u.status === "active" || u.status === "away";
            const avBg = u.role === "super_admin" ? c.green : u.role === "admin" ? c.greenMid : live ? c.warn : "#c4bdb0";
            return (
              <div key={u.id} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${c.rowBd}`, opacity: live ? 1 : 0.72 }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
                  <Avatar name={u.full_name || u.email} size={32} bg={avBg} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{u.full_name || "—"}</div>
                    <div style={{ fontSize: 11.5, color: c.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                  </div>
                </div>
                <div style={{ flex: "none", width: 140 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: b.bg, color: b.fg, fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 5 }}>
                    {b.shield && <Icon name="shield" size={11} strokeWidth={2} />}{ROLE_LABEL[u.role]}
                  </span>
                </div>
                <div style={{ flex: "none", width: 120 }}>
                  {u.status === "invite_sent" || u.role === "super_admin" || isYou ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: STATUS_META[u.status].color, fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_META[u.status].dot }} />{STATUS_META[u.status].label}
                    </span>
                  ) : (
                    <select value={u.status} onChange={(e) => changeStatus(u, e.target.value as UserStatus)} style={{ fontSize: 11.5, fontWeight: 600, color: STATUS_META[u.status].color, border: `1px solid ${c.border3}`, borderRadius: 6, padding: "3px 7px", background: "#fff", cursor: "pointer", outline: "none" }}>
                      <option value="active">Active</option>
                      <option value="away">Away</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  )}
                </div>
                <div style={{ flex: "none", width: 130, fontSize: 12, color: c.muted2 }}>{lastActiveLabel(u.updated_at)}</div>
                <div style={{ flex: "none", width: 40, textAlign: "right", color: c.faint }}>
                  {isYou ? <span style={{ fontSize: 11, fontStyle: "italic", color: "#c4bdb0" }}>You</span>
                    : u.role === "super_admin" ? null
                      : <KebabMenu disabled={removing === u.id} items={[{ label: "Remove user", danger: true, onClick: () => setToRemove(u) }]} />}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 34, textAlign: "center", color: c.faint, fontSize: 13 }}>No users.</div>}
        </div>

        <div style={{ fontSize: 11.5, color: c.faint, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="info" size={13} strokeWidth={1.8} /> The Super Admin role is hard-coded and cannot be reassigned or removed.
        </div>
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={load} />}
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

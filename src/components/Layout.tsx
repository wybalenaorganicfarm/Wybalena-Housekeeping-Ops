import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { c, font, ROLE_LABEL } from "../theme";
import { Icon } from "./Icon";
import { Avatar, ConfirmDialog } from "./ui";
import { getAlerts } from "../lib/api";

function NavItem({ to, icon, label, badge }: { to: string; icon: string; label: string; badge?: number }) {
  return (
    <NavLink to={to} end={to === "/"} style={({ isActive }) => ({
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 10px", borderRadius: 6, fontSize: 13, textDecoration: "none",
      color: isActive ? "#fff" : "#bcd2c5", fontWeight: isActive ? 600 : 500,
      background: isActive ? c.greenMid : "transparent",
    })}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name={icon} size={16} /> {label}
      </span>
      {badge ? (
        <span style={{ background: c.danger, color: "#fff", fontSize: 10, fontWeight: 600, borderRadius: 20, padding: "0 6px", lineHeight: "16px" }}>{badge}</span>
      ) : null}
    </NavLink>
  );
}

function NavIcon({ to, icon, label, badge }: { to: string; icon: string; label: string; badge?: number }) {
  return (
    <NavLink to={to} end={to === "/"} title={label} style={({ isActive }) => ({
      position: "relative", width: 32, height: 32, borderRadius: 6,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: isActive ? "#fff" : "#bcd2c5",
      background: isActive ? c.greenMid : "transparent",
    })}>
      <Icon name={icon} size={16} />
      {badge ? (
        <span style={{ position: "absolute", top: -3, right: -3, background: c.danger, color: "#fff", fontSize: 9, fontWeight: 600, borderRadius: 20, minWidth: 15, height: 15, padding: "0 4px", lineHeight: "15px", textAlign: "center" }}>{badge}</span>
      ) : null}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { profile, role, isSuperAdmin, canEdit, signOut } = useAuth();
  const navigate = useNavigate();
  const [openAlerts, setOpenAlerts] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  useEffect(() => {
    getAlerts().then((a) => setOpenAlerts(a.filter((x) => x.status === "open").length));
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: c.sand }}>
      {collapsed && (
        <aside style={{ flex: "none", width: 56, background: c.green, padding: "16px 0", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <button onClick={() => setCollapsed(false)} title="Open sidebar"
            style={{ width: 32, height: 32, flex: "none", border: "none", borderRadius: 6, background: "rgba(255,255,255,.08)", color: "#bcd2c5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="panel" size={16} />
          </button>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 22 }}>
            <NavIcon to="/" icon="dashboard" label="Dashboard" />
            <NavIcon to="/alerts" icon="alert" label="Alerts" badge={openAlerts || undefined} />
            <NavIcon to="/bookings" icon="book" label="Bookings" />
            <NavIcon to="/shifts" icon="calendar" label="Shifts" />
            <NavIcon to="/cleaners" icon="users" label="Cleaners" />
            {canEdit && <NavIcon to="/logs" icon="activity" label="System Logs" />}
            {isSuperAdmin && <NavIcon to="/users" icon="user" label="Users" />}
          </nav>
          <div style={{ flex: 1 }} />
          <Avatar name={profile?.full_name || profile?.email || "?"} />
          <button onClick={() => setConfirmOut(true)} title="Sign out"
            style={{ width: 32, height: 32, flex: "none", marginTop: 10, border: "none", background: "rgba(255,255,255,.1)", borderRadius: 6, color: "#7fa491", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="logout" size={14} strokeWidth={1.8} />
          </button>
        </aside>
      )}
      {!collapsed && (
      <aside style={{ flex: "none", width: 224, background: c.green, padding: "18px 12px 16px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 4px 0 10px" }}>
          <div>
            <div style={{ fontFamily: font.body, fontWeight: 700, fontSize: 18, color: "#fff" }}>Wybalena</div>
            <div style={{ fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7fa491", fontWeight: 600, marginTop: 2 }}>Housekeeping Operations</div>
          </div>
          <button onClick={() => setCollapsed(true)} title="Close sidebar"
            style={{ width: 28, height: 28, flex: "none", border: "none", borderRadius: 6, background: "rgba(255,255,255,.08)", color: "#bcd2c5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="panel" size={16} />
          </button>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 24 }}>
          <NavItem to="/" icon="dashboard" label="Dashboard" />
          <NavItem to="/alerts" icon="alert" label="Alerts" badge={openAlerts || undefined} />
          <NavItem to="/bookings" icon="book" label="Bookings" />
          <NavItem to="/shifts" icon="calendar" label="Shifts" />
          <NavItem to="/cleaners" icon="users" label="Cleaners" />
          {canEdit && <NavItem to="/logs" icon="activity" label="System Logs" />}
          {isSuperAdmin && (
            <>
              <div style={{ height: 1, background: "rgba(255,255,255,.1)", margin: "8px 10px" }} />
              <div style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5e7d6c", fontWeight: 600, padding: "2px 10px 6px" }}>Super admin</div>
              <NavItem to="/users" icon="user" label="Users" />
            </>
          )}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 10px 0", marginTop: 10, borderTop: "1px solid rgba(255,255,255,.12)" }}>
          <Avatar name={profile?.full_name || profile?.email || "?"} />
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile?.full_name || profile?.email}</div>
            <div style={{ fontSize: 10.5, color: "#7fa491" }}>{role ? ROLE_LABEL[role] : ""}</div>
          </div>
          <button onClick={() => setConfirmOut(true)} title="Sign out"
            style={{ width: 26, height: 26, flex: "none", border: "none", background: "rgba(255,255,255,.1)", borderRadius: 5, color: "#7fa491", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="logout" size={13} strokeWidth={1.8} />
          </button>
        </div>
      </aside>
      )}
      <main style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>{children}</main>
      {confirmOut && (
        <ConfirmDialog
          title="Sign out"
          message="Are you sure you want to log out?"
          confirmLabel="Log out"
          danger
          onCancel={() => setConfirmOut(false)}
          onConfirm={async () => { setConfirmOut(false); await signOut(); navigate("/"); }}
        />
      )}
    </div>
  );
}

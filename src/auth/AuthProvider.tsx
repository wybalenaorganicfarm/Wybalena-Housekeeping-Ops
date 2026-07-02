import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { activateSelf } from "../lib/api";
import type { Profile, UserRole } from "../lib/types";

interface AuthState {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  role: UserRole | null;
  canEdit: boolean; // admin + super_admin: full access; team_leader read-only
  isSuperAdmin: boolean;
  isTeamLead: boolean; // read-only, except cleaner status + notes
  needsPassword: boolean; // arrived via invite/recovery link, must set a password
  signIn: (email: string, password: string) => Promise<string | null>;
  setPassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Captured synchronously on first render, before supabase consumes the URL
  // hash. An invite/recovery link lands here and must set a password first.
  const [needsPassword, setNeedsPassword] = useState(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    return h.includes("type=invite") || h.includes("type=recovery");
  });

  async function loadProfile(uid: string) {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile(data ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      if (uid) await loadProfile(uid);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (uid) await loadProfile(uid);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }

  // Used by invited users (and password resets) to set their own password. The
  // invite link already created a session; this just attaches a password.
  async function setPassword(password: string): Promise<string | null> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return error.message;
    await activateSelf().catch(() => {}); // flip invite_sent -> active; best-effort
    if (userId) await loadProfile(userId);
    if (typeof window !== "undefined") history.replaceState(null, "", window.location.pathname);
    setNeedsPassword(false);
    return null;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setUserId(null);
  }

  const role = profile?.role ?? null;
  const value: AuthState = {
    loading,
    userId,
    profile,
    role,
    canEdit: role === "admin" || role === "super_admin" || role === "operations_manager",
    isSuperAdmin: role === "super_admin",
    isTeamLead: role === "team_leader",
    needsPassword,
    signIn,
    setPassword,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

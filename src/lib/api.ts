import { supabase, invokeFn } from "./supabase";
import { friendlyError } from "./errors";
import type {
  Alert, AuditLogResolved, Booking, Cleaner, CleanerNote, CleanerReliability, Profile, Shift, ShiftAssignment, ShiftStaffing,
} from "./types";

// ---- Reads (governed by RLS) -----------------------------------------------

export async function getShifts(): Promise<Shift[]> {
  const { data } = await supabase
    .from("shifts").select("*").order("shift_date", { ascending: true });
  return data ?? [];
}

export async function getShift(id: string): Promise<Shift | null> {
  const { data } = await supabase.from("shifts").select("*").eq("id", id).maybeSingle();
  return (data as Shift | null) ?? null;
}

// Resolve profile display names by id (RLS-safe via SECURITY DEFINER RPC). Used
// for note authors and shift special-instruction authorship.
export async function getProfileNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { id: string; full_name: string }[] | null }>;
  }).rpc("profile_names", { ids: unique });
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.id] = r.full_name;
  return map;
}

// ---- Cleaner notes ---------------------------------------------------------

export async function getCleanerNotes(cleanerId: string): Promise<CleanerNote[]> {
  const { data } = await supabase
    .from("cleaner_notes").select("*").eq("cleaner_id", cleanerId)
    .order("created_at", { ascending: false });
  return (data as CleanerNote[] | null) ?? [];
}

// author_id defaults to auth.uid() in the DB, so we only send cleaner_id + body.
export async function addCleanerNote(cleanerId: string, body: string): Promise<string | null> {
  const { error } = await supabase
    .from("cleaner_notes").insert({ cleaner_id: cleanerId, body } as never);
  return error ? friendlyError(error.message) : null;
}

export async function getStaffing(): Promise<Record<string, ShiftStaffing>> {
  const { data } = await supabase.from("shift_staffing").select("*");
  const map: Record<string, ShiftStaffing> = {};
  for (const r of (data ?? []) as ShiftStaffing[]) map[r.shift_id] = r;
  return map;
}

export async function getBookings(): Promise<Booking[]> {
  const { data } = await supabase
    .from("bookings").select("*").order("check_in", { ascending: true });
  return data ?? [];
}

export async function getAlerts(): Promise<Alert[]> {
  const { data } = await supabase
    .from("alerts").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

export async function getCleaners(): Promise<Cleaner[]> {
  const { data } = await supabase
    .from("cleaners").select("*").order("full_name", { ascending: true });
  return data ?? [];
}

// The single team leader lives in profiles (role = team_leader), not cleaners.
// They're implicitly assigned to every shift, so the UI injects them into the
// staffing meter and responder list.
export async function getTeamLead(): Promise<{ id: string; full_name: string } | null> {
  // RLS-safe RPC (SECURITY DEFINER) — profiles reads may be limited to super
  // admins, but everyone who can view a shift should see the lead's name.
  const { data } = await (supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: { id: string; full_name: string }[] | null }>;
  }).rpc("get_team_lead");
  const row = data?.[0];
  return row ? { id: row.id, full_name: row.full_name ?? "Team Lead" } : null;
}

export async function getReliability(): Promise<Record<string, CleanerReliability>> {
  const { data } = await supabase.from("cleaner_reliability").select("*");
  const map: Record<string, CleanerReliability> = {};
  for (const r of (data ?? []) as CleanerReliability[]) map[r.cleaner_id] = r;
  return map;
}

// ---- Audit logs (read-only; admin + super_admin via RLS) -------------------

export const AUDIT_PAGE_SIZE = 50;

export interface AuditLogQuery {
  status?: string;   // "all" | success | failed | warning | skipped
  source?: string;   // "all" | function source key
  from?: string;     // ISO lower bound on created_at
  to?: string;       // ISO upper bound on created_at
  search?: string;   // matched against summary
  page?: number;     // 0-based
}

const AUDIT_SELECT = `
  *,
  shift:shifts(shift_date, shift_type),
  booking:bookings(guest_name, check_in, check_out),
  cleaner:cleaners(full_name)
`;

export async function getAuditLogs(q: AuditLogQuery = {}): Promise<{ rows: AuditLogResolved[]; total: number }> {
  const page = q.page ?? 0;
  let query = supabase
    .from("audit_logs")
    .select(AUDIT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });

  if (q.status && q.status !== "all") query = query.eq("status", q.status);
  if (q.source && q.source !== "all") query = query.eq("source", q.source);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", q.to);
  if (q.search?.trim()) query = query.ilike("summary", `%${q.search.trim()}%`);

  const start = page * AUDIT_PAGE_SIZE;
  const { data, count } = await query.range(start, start + AUDIT_PAGE_SIZE - 1);
  return { rows: (data ?? []) as unknown as AuditLogResolved[], total: count ?? 0 };
}

// Count of failures in the last 24h — drives the dismissible banner.
export async function getRecentFailureCount(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);
  return count ?? 0;
}

export async function getUsers(): Promise<Profile[]> {
  const { data } = await supabase
    .from("profiles").select("*").order("created_at", { ascending: true });
  return data ?? [];
}

export async function getResponseSummary(): Promise<{ accepted: number; declined: number; no_response: number }> {
  const { data } = await supabase.from("shift_assignments").select("status");
  let accepted = 0, declined = 0, no_response = 0;
  for (const r of (data ?? []) as { status: string }[]) {
    if (r.status === "accepted") accepted++;
    else if (r.status === "declined") declined++;
    else if (r.status === "no_response" || r.status === "offered") no_response++;
  }
  return { accepted, declined, no_response };
}

export async function getAssignmentsForShift(shiftId: string): Promise<ShiftAssignment[]> {
  const { data } = await supabase
    .from("shift_assignments").select("*").eq("shift_id", shiftId)
    .order("offered_at", { ascending: true });
  return data ?? [];
}

// ---- Direct writes via RLS (admin+ only; team_leader blocked by policy) -----

export async function createShift(input: {
  shift_type: string; shift_date: string; start_time: string;
  estimated_hours: number; required_cleaners: number;
  special_instructions?: string | null; venue_scope?: string; buildings?: string[];
}): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.from("shifts").insert({
    ...input, status: "pending_confirmation", source: "manual",
  } as never).select("id").single();
  if (error) return { error: friendlyError(error.message) };
  return { id: (data as { id: string }).id };
}

export async function deleteShift(id: string): Promise<string | null> {
  const { error } = await supabase.from("shifts").delete().eq("id", id);
  return error ? friendlyError(error.message) : null;
}

// Routed through the update-shift Edge Function so the edit is recorded in the audit
// log ("<admin> edited the shift…"); a direct RLS update can't write audit_logs.
export async function updateShift(id: string, patch: Partial<Shift>): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("update-shift", { shiftId: id, patch });
  if (error) return error;
  if (data?.error) return data.error;
  return null;
}

export async function addCleaner(input: {
  full_name: string; phone: string; email?: string; tier: string;
}): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string; id?: string }>("add-cleaner", input);
  if (error) return error;
  if (data?.error) return data.error;
  return null;
}

export async function dismissAlert(id: string): Promise<void> {
  await supabase.from("alerts").update({ status: "dismissed" } as never).eq("id", id);
}

// ---- Privileged actions via Edge Functions (service-role side effects) ------

export const confirmShifts = (shiftIds: string[]) =>
  invokeFn("confirm-shifts", { shiftIds });

export const manualAssign = (shiftId: string, cleanerId: string) =>
  invokeFn("manual-assign", { shiftId, cleanerId });

export const confirmCancellation = (alertId: string) =>
  invokeFn("confirm-cancellation", { alertId });

export const removeCleaner = (cleanerId: string) =>
  invokeFn<{ ok: boolean; mode: "deleted" | "deactivated"; emailed: boolean }>("remove-cleaner", { cleanerId });

export const provisionUser = (input: {
  email: string; full_name: string; role: string; redirectTo: string; phone?: string;
}) => invokeFn<{ ok?: boolean; userId?: string }>("provision-user", input);

export const removeUser = (userId: string) =>
  invokeFn<{ ok: boolean; emailed: boolean }>("remove-user", { userId });

// Change a user's role (Users page) — routed through an Edge Function (audit log +
// service-role write). The Operations Manager receives all system emails.
export async function setUserRole(userId: string, role: string): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("set-user-role", { userId, role });
  return error ?? data?.error ?? null;
}

// Edit a cleaner's contact details (phone/email) — Edge Function for the audit log.
export async function updateCleaner(cleanerId: string, input: { phone: string; email: string | null }): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("update-cleaner", { cleanerId, ...input });
  return error ?? data?.error ?? null;
}

export const activateSelf = () => invokeFn("activate-self", {});

export async function setUserStatus(userId: string, status: string): Promise<string | null> {
  const { error } = await supabase
    .from("profiles").update({ status, is_active: status !== "inactive" } as never).eq("id", userId);
  return error ? friendlyError(error.message) : null;
}

// Set/clear a user's phone (used for WhatsApp system alerts). Direct RLS update —
// admin/ops-manager/super_admin all have profiles write access.
export async function setUserPhone(userId: string, phone: string | null): Promise<string | null> {
  const { error } = await supabase
    .from("profiles").update({ phone } as never).eq("id", userId);
  return error ? friendlyError(error.message) : null;
}

// Keep a team leader's cleaner row in sync with their user status. away/inactive
// stop offers (is_active only true when active).
export async function setCleanerStatusByEmail(email: string, status: string): Promise<void> {
  await supabase.from("cleaners")
    .update({ status, is_active: status === "active" } as never)
    .eq("email", email.toLowerCase()).eq("is_team_leader", true);
}

// Cleaner status change (Cleaners page) — routed through an Edge Function so the
// team-leader → profiles sync works regardless of the caller's RLS write rights.
export const setCleanerStatus = (cleanerId: string, status: string) =>
  invokeFn<{ ok: boolean }>("set-cleaner-status", { cleanerId, status });

// ---- Automation schedule (pg_cron) — via manage-cron Edge Function -----------

export interface CronJob { fn: string; schedule: string; active: boolean }

export async function getCronSchedules(): Promise<CronJob[]> {
  const { data, error } = await invokeFn<{ jobs: CronJob[]; error?: string }>("manage-cron", { action: "list" });
  if (error || data?.error) throw new Error(error ?? data?.error ?? "Failed to load schedules");
  return data?.jobs ?? [];
}

export async function updateCronSchedule(fn: string, schedule: string, active: boolean): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("manage-cron", {
    action: "update", fn, schedule, active,
  });
  if (error) return error;
  if (data?.error) return data.error;
  return null;
}

// ---- Connections / integration health (admin) ------------------------------

export interface ConnectionResult {
  name: string;         // supabase | whapi | gmail | google_calendar
  label: string;        // human-readable
  provider: string;     // "google" for gmail/calendar — drives the reconnect button
  configured: boolean;
  ok: boolean;
  detail: string;
}

export interface ConnectionStatus {
  results: ConnectionResult[];
  google: { email: string | null; connectedAt: string | null } | null;
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const { data, error } = await invokeFn<ConnectionStatus>("get-connection-status", {});
  if (error || !data) throw new Error(error ?? "Failed to load connection status");
  return data;
}

// Kick off the Google reconnect: returns the consent URL the portal opens in a
// popup. The one-time redirect-URI setup in Google Cloud makes this a true 1-click.
export async function startGoogleReconnect(): Promise<string> {
  const { data, error } = await invokeFn<{ url?: string; error?: string }>("google-oauth-start", { origin: window.location.origin });
  if (error || data?.error || !data?.url) throw new Error(error ?? data?.error ?? "Could not start Google reconnect");
  return data.url;
}

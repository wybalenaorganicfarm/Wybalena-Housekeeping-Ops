import { supabase, invokeFn } from "./supabase";
import { friendlyError } from "./errors";
import type {
  Alert, AuditLogResolved, Booking, Cleaner, CleanerNote, CleanerReliability, MessageTemplate, MessageTemplatePatch, Profile, Shift, ShiftAssignment, ShiftStaffing,
} from "./types";

// ---- Reads (governed by RLS) -----------------------------------------------

// A failed read must NOT look like an empty result — that is how "data comes
// through blank" bugs happen (a list renders empty, a lookup renders nothing).
// These helpers throw on error so the caller's error boundary / catch handles it,
// and only return `data` when the query genuinely succeeded. `unwrap` keeps the
// null-vs-error distinction for single-row reads (null row is valid; error is not).
function unwrapRows<T>(res: { data: T[] | null; error: unknown }): T[] {
  if (res.error) throw new Error(friendlyError((res.error as { message?: string }).message ?? "Read failed"));
  return res.data ?? [];
}
function unwrap<T>(res: { data: T | null; error: unknown }): T | null {
  if (res.error) throw new Error(friendlyError((res.error as { message?: string }).message ?? "Read failed"));
  return res.data ?? null;
}

export async function getShifts(): Promise<Shift[]> {
  return unwrapRows(await supabase
    .from("shifts").select("*").order("shift_date", { ascending: true }));
}

export async function getShift(id: string): Promise<Shift | null> {
  return unwrap<Shift>(await supabase.from("shifts").select("*").eq("id", id).maybeSingle());
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
  return unwrapRows<CleanerNote>(await supabase
    .from("cleaner_notes").select("*").eq("cleaner_id", cleanerId)
    .order("created_at", { ascending: false }));
}

// Latest note per cleaner, for the inline Notes column on the Cleaners page.
// One query for all notes (newest first); we keep the first row seen per
// cleaner, so the map holds each cleaner's most recent note.
export async function getLatestCleanerNotes(): Promise<Record<string, CleanerNote>> {
  const rows = unwrapRows<CleanerNote>(await supabase
    .from("cleaner_notes").select("*").order("created_at", { ascending: false }));
  const map: Record<string, CleanerNote> = {};
  for (const n of rows) if (!map[n.cleaner_id]) map[n.cleaner_id] = n;
  return map;
}

// author_id defaults to auth.uid() in the DB, so we only send cleaner_id + body.
export async function addCleanerNote(cleanerId: string, body: string): Promise<string | null> {
  const { error } = await supabase
    .from("cleaner_notes").insert({ cleaner_id: cleanerId, body } as never);
  return error ? friendlyError(error.message) : null;
}

export async function getStaffing(): Promise<Record<string, ShiftStaffing>> {
  const rows = unwrapRows<ShiftStaffing>(await supabase.from("shift_staffing").select("*"));
  const map: Record<string, ShiftStaffing> = {};
  for (const r of rows) map[r.shift_id] = r;
  return map;
}

export async function getBookings(): Promise<Booking[]> {
  return unwrapRows<Booking>(await supabase
    .from("bookings").select("*").order("check_in", { ascending: true }));
}

export async function getAlerts(): Promise<Alert[]> {
  return unwrapRows<Alert>(await supabase
    .from("alerts").select("*").order("created_at", { ascending: false }));
}

export async function getCleaners(): Promise<Cleaner[]> {
  return unwrapRows<Cleaner>(await supabase
    .from("cleaners").select("*").order("full_name", { ascending: true }));
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
  const rows = unwrapRows<CleanerReliability>(await supabase.from("cleaner_reliability").select("*"));
  const map: Record<string, CleanerReliability> = {};
  for (const r of rows) map[r.cleaner_id] = r;
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
  // A failed audit read must surface — never render as "no logs", which would hide
  // the very failures this page exists to show.
  const { data, count, error } = await query.range(start, start + AUDIT_PAGE_SIZE - 1);
  if (error) throw new Error(friendlyError(error.message));
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

// ---- Message templates (admin + operations_manager via RLS) ----------------

export async function getMessageTemplates(): Promise<MessageTemplate[]> {
  return unwrapRows<MessageTemplate>(await supabase
    .from("message_templates").select("*").order("sort_order", { ascending: true }));
}

// Update the editable fields of one template. updated_at / updated_by are stamped
// by a DB trigger. RLS blocks anyone below admin / operations_manager.
export async function updateMessageTemplate(
  key: string,
  patch: MessageTemplatePatch,
): Promise<string | null> {
  const { error } = await supabase
    .from("message_templates").update(patch as never).eq("key", key);
  return error ? friendlyError(error.message) : null;
}

export async function getUsers(): Promise<Profile[]> {
  return unwrapRows<Profile>(await supabase
    .from("profiles").select("*").order("created_at", { ascending: true }));
}

export async function getResponseSummary(): Promise<{ accepted: number; declined: number; no_response: number }> {
  const rows = unwrapRows<{ status: string }>(await supabase.from("shift_assignments").select("status"));
  let accepted = 0, declined = 0, no_response = 0;
  for (const r of rows) {
    if (r.status === "accepted") accepted++;
    else if (r.status === "declined") declined++;
    else if (r.status === "no_response" || r.status === "offered") no_response++;
  }
  return { accepted, declined, no_response };
}

export async function getAssignmentsForShift(shiftId: string): Promise<ShiftAssignment[]> {
  return unwrapRows<ShiftAssignment>(await supabase
    .from("shift_assignments").select("*").eq("shift_id", shiftId)
    .order("offered_at", { ascending: true }));
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

// Yields the NEW cleaner's id on success so the caller can act on the row it just
// created (nominating a Cleaning Manager in the same flow). Returns the error
// string on failure, matching the other mutating helpers' convention.
export async function addCleanerReturning(input: {
  full_name: string; phone: string; email?: string; tier: string;
}): Promise<{ id: string } | string> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string; id?: string }>("add-cleaner", input);
  if (error) return error;
  if (data?.error) return data.error;
  if (!data?.id) return "Cleaner was created but no id came back — reload the page to see them.";
  return { id: data.id };
}

export async function dismissAlert(id: string): Promise<string | null> {
  const { error } = await supabase.from("alerts").update({ status: "dismissed" } as never).eq("id", id);
  return error ? friendlyError(error.message) : null;
}

// ---- Privileged actions via Edge Functions (service-role side effects) ------

export const confirmShifts = (shiftIds: string[]) =>
  invokeFn("confirm-shifts", { shiftIds });

export const manualAssign = (shiftId: string, cleanerId: string) =>
  invokeFn("manual-assign", { shiftId, cleanerId });

// Admin per-cleaner state changes from the Assign-manually modal. Each is
// writer-gated + audit-logged server-side; cleaner messaging is best-effort.
export const withdrawOffer = (assignmentId: string) =>
  invokeFn<{ ok?: boolean; error?: string; notified?: boolean }>("withdraw-offer", { assignmentId });

export const cancelAccepted = (assignmentId: string) =>
  invokeFn<{ ok?: boolean; error?: string; notified?: boolean }>("cancel-accepted", { assignmentId });

export const addAccepted = (shiftId: string, cleanerId: string) =>
  invokeFn<{ ok?: boolean; error?: string; notified?: boolean }>("add-accepted", { shiftId, cleanerId });

export const confirmCancellation = (alertId: string) =>
  invokeFn("confirm-cancellation", { alertId });

// Removal never notifies the cleaner — no email or WhatsApp is sent.
export const removeCleaner = (cleanerId: string) =>
  invokeFn<{ ok: boolean; mode: "deleted" | "deactivated" }>("remove-cleaner", { cleanerId });

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

// Nominate (or, with null, clear) the Cleaning Manager — the one cleaner who is
// auto-rostered onto every non-wipeover shift. Routed through an Edge Function
// (atomic single-holder RPC + audit log + service-role write).
export async function setManager(cleanerId: string | null): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("set-manager", { cleanerId });
  return error ?? data?.error ?? null;
}

// Step ONE holder down. The role is multi-holder, so this must target the named
// cleaner — setManager(null) clears EVERY manager and is not what a single
// "remove as Cleaning Manager" means.
export async function stepDownManager(cleanerId: string): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string }>("set-manager", { stepDownId: cleanerId });
  return error ?? data?.error ?? null;
}

// Edit a cleaner's contact details (phone/email) — Edge Function for the audit log.
export async function updateCleaner(cleanerId: string, input: { phone: string; email: string | null; tier?: string }): Promise<string | null> {
  const { data, error } = await invokeFn<{ ok?: boolean; error?: string; tier?: string }>("update-cleaner", { cleanerId, ...input });
  if (error) return error;
  if (data?.error) return data.error;
  // An older deployment of the function accepts the call but drops `tier` — it
  // echoes nothing back. Write the tier directly (admin/ops-manager RLS allows
  // it) so the change isn't silently lost.
  if (input.tier && data?.tier !== input.tier) {
    const { error: tierErr } = await supabase
      .from("cleaners").update({ tier: input.tier } as never).eq("id", cleanerId);
    if (tierErr) return friendlyError(tierErr.message);
  }
  return null;
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

// Keep a team leader's cleaner row in sync with their user status. inactive
// stops offers (is_active only true when active).
export async function setCleanerStatusByEmail(email: string, status: string): Promise<string | null> {
  const { error } = await supabase.from("cleaners")
    .update({ status, is_active: status === "active" } as never)
    .eq("email", email.toLowerCase()).eq("is_team_leader", true);
  return error ? friendlyError(error.message) : null;
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

// ---- Booking sync date range (app_settings) --------------------------------
// How far ahead the Weekly Booking Sync looks and how long a window it covers.
// RLS restricts writes to admin / operations_manager, so this goes direct rather
// than through an Edge Function. sync-bookings falls back to 5 weeks / 7 days if
// the row is ever missing, so a read failure here is display-only.

export interface BookingSyncRange { lead_weeks: number; window_days: number }

export const BOOKING_SYNC_RANGE_DEFAULT: BookingSyncRange = { lead_weeks: 5, window_days: 7 };
export const BOOKING_SYNC_RANGE_LIMITS = {
  lead_weeks: { min: 0, max: 52 },
  window_days: { min: 1, max: 90 },
};

export async function getBookingSyncRange(): Promise<BookingSyncRange> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "booking_sync_range").maybeSingle();
  if (error || !data) return BOOKING_SYNC_RANGE_DEFAULT;
  const v = (data as { value: Partial<BookingSyncRange> }).value ?? {};
  return {
    lead_weeks: Number(v.lead_weeks ?? BOOKING_SYNC_RANGE_DEFAULT.lead_weeks),
    window_days: Number(v.window_days ?? BOOKING_SYNC_RANGE_DEFAULT.window_days),
  };
}

export async function updateBookingSyncRange(range: BookingSyncRange): Promise<string | null> {
  const { error } = await supabase
    .from("app_settings").update({ value: range } as never).eq("key", "booking_sync_range");
  return error ? friendlyError(error.message) : null;
}

// ---- Staffing catch-up timing (app_settings) -------------------------------
// How many days a shift waits at one tier before the daily catch-up escalates it.
// Days, not hours: the job runs on one fixed daily slot, so an hours-based gate
// always landed a fraction short of 24h and slipped an extra day. staffing-catchup
// falls back to 1 day if the row is missing.

export interface StaffingCatchup { escalation_wait_days: number; offer_grace_hours: number }

export const STAFFING_CATCHUP_DEFAULT: StaffingCatchup = { escalation_wait_days: 1, offer_grace_hours: 0 };
export const STAFFING_CATCHUP_LIMITS = {
  escalation_wait_days: { min: 1, max: 7 },
  offer_grace_hours: { min: 0, max: 72 },
};

export async function getStaffingCatchup(): Promise<StaffingCatchup> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "staffing_catchup").maybeSingle();
  if (error || !data) return STAFFING_CATCHUP_DEFAULT;
  const v = (data as { value: Partial<StaffingCatchup> & { escalation_wait_hours?: number } }).value ?? {};
  // Read a pre-migration row (hours) as whole days so the page never shows a
  // figure the job isn't actually using.
  const legacyDays = v.escalation_wait_hours === undefined
    ? undefined
    : Math.max(1, Math.round(Number(v.escalation_wait_hours) / 24));
  return {
    escalation_wait_days: Number(v.escalation_wait_days ?? legacyDays ?? STAFFING_CATCHUP_DEFAULT.escalation_wait_days),
    offer_grace_hours: Number(v.offer_grace_hours ?? STAFFING_CATCHUP_DEFAULT.offer_grace_hours),
  };
}

export async function updateStaffingCatchup(next: StaffingCatchup): Promise<string | null> {
  const { error } = await supabase
    .from("app_settings").update({ value: next } as never).eq("key", "staffing_catchup");
  return error ? friendlyError(error.message) : null;
}

// ---- Cancellation cooling-off (app_settings) -------------------------------
// After a cleaner cancels a shift, how long before that shift can be offered
// back to her automatically. Hours (not days like the catch-up): this is checked
// against a timestamp when a cancellation happens, not across daily cron slots.
// 0 switches the cooling-off off entirely.

export interface CancellationCooloff { cooloff_hours: number }

export const CANCELLATION_COOLOFF_DEFAULT: CancellationCooloff = { cooloff_hours: 48 };
export const CANCELLATION_COOLOFF_LIMITS = {
  cooloff_hours: { min: 0, max: 336 },  // up to 14 days
};

export async function getCancellationCooloff(): Promise<CancellationCooloff> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "cancellation_cooloff").maybeSingle();
  if (error || !data) return CANCELLATION_COOLOFF_DEFAULT;
  const v = (data as { value: Partial<CancellationCooloff> }).value ?? {};
  return {
    cooloff_hours: Number(v.cooloff_hours ?? CANCELLATION_COOLOFF_DEFAULT.cooloff_hours),
  };
}

export async function updateCancellationCooloff(next: CancellationCooloff): Promise<string | null> {
  const { error } = await supabase
    .from("app_settings").update({ value: next } as never).eq("key", "cancellation_cooloff");
  return error ? friendlyError(error.message) : null;
}

// ---- Event-driven notification switches -------------------------------------
// Behaviour that fires on an EVENT rather than a schedule, so it has no cron job
// and cannot appear on the Schedule page as a timed row. Still fully on/off-able
// by an admin, per the venue's standing requirement that everything the system
// does is visible and editable.

export interface NotificationSwitches { lead_cleaner_cancelled: boolean }

// Defaults ON: each notification existed before its switch did, so an absent or
// malformed row must reproduce current behaviour, not silently go quiet.
export const NOTIFICATION_SWITCHES_DEFAULT: NotificationSwitches = { lead_cleaner_cancelled: true };

export async function getNotificationSwitches(): Promise<NotificationSwitches> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "notification_switches").maybeSingle();
  if (error || !data) return NOTIFICATION_SWITCHES_DEFAULT;
  const v = (data as { value: Partial<NotificationSwitches> }).value ?? {};
  // Only an explicit false is off — mirrors loadNotificationSwitches() on the
  // Edge Function side so the app and the sender never disagree.
  return { lead_cleaner_cancelled: v.lead_cleaner_cancelled !== false };
}

export async function updateNotificationSwitches(next: NotificationSwitches): Promise<string | null> {
  // UPDATE, not upsert. app_settings has RLS policies for SELECT and UPDATE
  // only — no INSERT policy exists, so an upsert against a missing row is
  // refused outright and surfaces as "You don't have permission to do that",
  // which points the reader at their account rather than at the real cause.
  //
  // `select()` makes the no-op detectable: an UPDATE matching zero rows is a
  // success with an empty result, so without this a missing settings row would
  // silently discard the change and the toggle would spring back on reload.
  const { data, error } = await supabase
    .from("app_settings").update({ value: next } as never).eq("key", "notification_switches").select("key");
  if (error) return friendlyError(error.message);
  if (!data || data.length === 0) {
    return "Notification settings aren't set up in the database yet — the 'notification_switches' row is missing. Run the pending migration (supabase db push), then try again.";
  }
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
  // Set on the check that found everything healthy again and closed the open
  // "connections need attention" alert. True once, not on every poll.
  alertResolved?: boolean;
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

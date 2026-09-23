// App-settings loader for Edge Functions.
//
// Operational knobs an Admin tunes from the app live in `app_settings`. Same
// safety contract as templates.ts: any miss (row absent, table not migrated,
// query error, malformed value) falls back to the caller's built-in default, so
// a cron run can never fail because a setting was deleted or mis-edited.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface BookingSyncRange {
  leadWeeks: number;   // how far ahead the target window starts
  windowDays: number;  // how many days it covers
}

// Matches the seeded row in 20260805140000_app_settings.sql. Reproduces the
// behaviour that was hardcoded in sync-bookings before the setting existed.
export const DEFAULT_BOOKING_SYNC_RANGE: BookingSyncRange = { leadWeeks: 5, windowDays: 7 };

// Bounds guard the cron job as much as the UI: a 0 or absurd value would make
// the sync silently cover nothing or hammer the calendar API.
export const RANGE_LIMITS = { leadWeeks: { min: 0, max: 52 }, windowDays: { min: 1, max: 90 } };

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// How the daily catch-up decides a shift has waited long enough.
//
// The tier wait is in DAYS, not hours, and deliberately so. The catch-up runs on
// one fixed daily slot, so an hours-based gate can never be cleared reliably: a
// "24h" comparison against an offer stamped a fraction of a second into the
// previous run always lands microscopically short and slips a whole extra day.
// Counting calendar days makes Tier 1 Monday → Tier 2 Tuesday → Tier 3 Wednesday
// exact, whatever the run latency.
export interface StaffingCatchup {
  escalationWaitDays: number;  // venue-local days at one tier before escalating
  offerGraceHours: number;     // after confirmation before the first offer
}

export const DEFAULT_STAFFING_CATCHUP: StaffingCatchup = { escalationWaitDays: 1, offerGraceHours: 0 };

export const CATCHUP_LIMITS = {
  escalationWaitDays: { min: 1, max: 7 },
  offerGraceHours: { min: 0, max: 72 },
};

export async function loadStaffingCatchup(sb: SupabaseClient): Promise<StaffingCatchup> {
  try {
    const { data } = await sb
      .from("app_settings").select("value").eq("key", "staffing_catchup").maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!v) return DEFAULT_STAFFING_CATCHUP;
    // Rows written before the switch to days stored escalation_wait_hours. Read
    // those as whole days rather than falling back to the default, so the job
    // keeps the admin's intent if it runs before the migration lands.
    const legacy = v.escalation_wait_hours;
    const legacyDays = legacy === undefined || legacy === null
      ? undefined
      : Math.max(1, Math.round(Number(legacy) / 24));
    return {
      escalationWaitDays: clampInt(v.escalation_wait_days ?? legacyDays, CATCHUP_LIMITS.escalationWaitDays.min, CATCHUP_LIMITS.escalationWaitDays.max, DEFAULT_STAFFING_CATCHUP.escalationWaitDays),
      offerGraceHours: clampInt(v.offer_grace_hours, CATCHUP_LIMITS.offerGraceHours.min, CATCHUP_LIMITS.offerGraceHours.max, DEFAULT_STAFFING_CATCHUP.offerGraceHours),
    };
  } catch {
    return DEFAULT_STAFFING_CATCHUP;
  }
}

// How long a cleaner who cancelled her own shift stays out of that shift's
// automatic re-offers.
//
// HOURS, not days: unlike escalationWaitDays above, this is compared against a
// stored timestamp at the moment a cancellation happens, not across fixed daily
// cron slots, so the fraction-of-a-day problem that forces days there does not
// arise here — and a sub-day window is the whole point.
//
// 0 disables the cooling-off: every self-canceller is immediately offerable
// again. Reachable on purpose, so the behaviour can be switched off from the app.
export interface CancellationCooloff {
  cooloffHours: number;
}

export const DEFAULT_CANCELLATION_COOLOFF: CancellationCooloff = { cooloffHours: 48 };

export const COOLOFF_LIMITS = { cooloffHours: { min: 0, max: 336 } };  // up to 14 days

// Event-driven notification switches.
//
// These fire on an EVENT (a cleaner cancels), not on a schedule, so they have no
// cron row and cannot live on the Automation Schedule page as a timed job. They
// are still operational behaviour the venue must be able to turn off, so they
// get a plain on/off here and a toggle in the app.
//
// Default TRUE for every switch: the behaviour existed before the setting did,
// so a missing/!malformed row must reproduce what the system already does rather
// than silently going quiet.
export interface NotificationSwitches {
  leadCleanerCancelled: boolean;  // alert the Cleaning Manager when a cleaner cancels
}

export const DEFAULT_NOTIFICATION_SWITCHES: NotificationSwitches = {
  leadCleanerCancelled: true,
};

// Only an explicit `false` turns a switch off. Anything else — absent key, null,
// a string, a mis-edit — keeps the notification ON, because the failure mode of
// "sent when you didn't expect it" is far safer here than a silent miss.
function boolOn(v: unknown, dflt: boolean): boolean {
  if (v === false || v === true) return v;
  return dflt;
}

export async function loadNotificationSwitches(sb: SupabaseClient): Promise<NotificationSwitches> {
  try {
    const { data } = await sb
      .from("app_settings").select("value").eq("key", "notification_switches").maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!v) return DEFAULT_NOTIFICATION_SWITCHES;
    return {
      leadCleanerCancelled: boolOn(v.lead_cleaner_cancelled, DEFAULT_NOTIFICATION_SWITCHES.leadCleanerCancelled),
    };
  } catch {
    return DEFAULT_NOTIFICATION_SWITCHES;
  }
}

export async function loadCancellationCooloff(sb: SupabaseClient): Promise<CancellationCooloff> {
  try {
    const { data } = await sb
      .from("app_settings").select("value").eq("key", "cancellation_cooloff").maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!v) return DEFAULT_CANCELLATION_COOLOFF;
    return {
      // `?? undefined` before clamping: Number(null) is 0, not NaN, so a row
      // holding an explicit null would clamp to 0 and silently DISABLE the
      // cooling-off rather than fall back to the default. 0 is a legitimate
      // value here ("off"), so it must only ever come from someone actually
      // choosing it.
      cooloffHours: clampInt(
        v.cooloff_hours ?? undefined,
        COOLOFF_LIMITS.cooloffHours.min,
        COOLOFF_LIMITS.cooloffHours.max,
        DEFAULT_CANCELLATION_COOLOFF.cooloffHours,
      ),
    };
  } catch {
    return DEFAULT_CANCELLATION_COOLOFF;
  }
}

export async function loadBookingSyncRange(sb: SupabaseClient): Promise<BookingSyncRange> {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "booking_sync_range")
      .maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!v) return DEFAULT_BOOKING_SYNC_RANGE;
    return {
      leadWeeks: clampInt(v.lead_weeks, RANGE_LIMITS.leadWeeks.min, RANGE_LIMITS.leadWeeks.max, DEFAULT_BOOKING_SYNC_RANGE.leadWeeks),
      windowDays: clampInt(v.window_days, RANGE_LIMITS.windowDays.min, RANGE_LIMITS.windowDays.max, DEFAULT_BOOKING_SYNC_RANGE.windowDays),
    };
  } catch {
    return DEFAULT_BOOKING_SYNC_RANGE;
  }
}

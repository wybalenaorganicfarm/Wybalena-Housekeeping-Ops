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
export interface StaffingCatchup {
  escalationWaitHours: number;  // at one tier before escalating to the next
  offerGraceHours: number;      // after confirmation before the first offer
}

export const DEFAULT_STAFFING_CATCHUP: StaffingCatchup = { escalationWaitHours: 24, offerGraceHours: 0 };

export const CATCHUP_LIMITS = {
  escalationWaitHours: { min: 1, max: 168 },  // 1 hour … 7 days
  offerGraceHours: { min: 0, max: 72 },
};

export async function loadStaffingCatchup(sb: SupabaseClient): Promise<StaffingCatchup> {
  try {
    const { data } = await sb
      .from("app_settings").select("value").eq("key", "staffing_catchup").maybeSingle();
    const v = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!v) return DEFAULT_STAFFING_CATCHUP;
    return {
      escalationWaitHours: clampInt(v.escalation_wait_hours, CATCHUP_LIMITS.escalationWaitHours.min, CATCHUP_LIMITS.escalationWaitHours.max, DEFAULT_STAFFING_CATCHUP.escalationWaitHours),
      offerGraceHours: clampInt(v.offer_grace_hours, CATCHUP_LIMITS.offerGraceHours.min, CATCHUP_LIMITS.offerGraceHours.max, DEFAULT_STAFFING_CATCHUP.offerGraceHours),
    };
  } catch {
    return DEFAULT_STAFFING_CATCHUP;
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

// Reaching Tier 3 means the shift has been through every cleaner tier and is
// still short — the point at which a human has to step in.
//
// This is the DAILY-safe form, used by staffing-catchup: the urgent email is
// sent only alongside a newly-raised alert, so a shift that stays understaffed
// doesn't email the Operations Manager every single day. The weekly
// escalate-tier-3 job keeps its own copy, which deliberately re-emails on each
// weekly run — once a week is a useful nudge, once a day is noise.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendEmail } from "./adapters/email.ts";
import { opsManager } from "./admin.ts";

export async function raiseTier3Alert(
  sb: SupabaseClient,
  shift: { id: string; shift_date: string; shift_type: string },
): Promise<void> {
  // One open alert per shift — a daily job would otherwise raise a new one every
  // run for the same understaffed shift.
  const { data: dup } = await sb
    .from("alerts")
    .select("id")
    .eq("alert_type", "understaffed_urgent")
    .eq("shift_id", shift.id)
    .eq("status", "open")
    .maybeSingle();
  if (!dup) {
    await sb.from("alerts").insert({
      alert_type: "understaffed_urgent",
      shift_id: shift.id,
      title: "Tier 3 reached — understaffed",
      body: `${shift.shift_type} on ${shift.shift_date} reached Tier 3 and still has open spots. Intervene manually.`,
    });
    // Only email alongside a NEW alert. Without this the daily catch-up would
    // send the same urgent email every single day until the shift is staffed.
    await sendEmail(
      "Wybalena URGENT: shift understaffed at Tier 3",
      `The ${shift.shift_type} shift on ${shift.shift_date} has reached Tier 3 and is still ` +
        `not fully staffed. Please assign cleaners manually.`,
      (await opsManager(sb)).email ?? undefined,
    );
  }
}

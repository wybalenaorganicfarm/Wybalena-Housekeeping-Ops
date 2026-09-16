// Best-effort cleaner notification for admin state-change endpoints
// (withdraw-offer / cancel-accepted / add-accepted). The DB row is the roster
// truth — the message is a courtesy, so a failed or skipped send NEVER blocks or
// reverts the state change the endpoint already committed. Skips an Inactive or
// phoneless cleaner, mirroring markFullyStaffed (engine.ts:650). Returns whether
// a message actually went out, for the audit line.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendMessage } from "./adapters/whatsapp.ts";
import { renderTemplate } from "./templates.ts";
import { prettyDate } from "./datetime.ts";

export async function notifyCleaner(
  sb: SupabaseClient,
  cleanerId: string,
  templateKey: string,
  fallback: string,
  shiftDate: string | null | undefined,
): Promise<boolean> {
  try {
    const { data: c } = await sb
      .from("cleaners").select("phone, is_active").eq("id", cleanerId).maybeSingle();
    if (!c?.phone || !c.is_active) return false;
    const body = await renderTemplate(sb, templateKey, fallback, {
      shift_date: prettyDate(shiftDate),
    });
    const res = await sendMessage(c.phone, body);
    return !!res?.ok;
  } catch (e) {
    // Never let a messaging failure bubble into the endpoint's success path.
    console.error(`[notifyCleaner] send failed for cleaner ${cleanerId}: ${String(e)}`);
    return false;
  }
}

// Audit log helper — the single way every Edge Function records what it did.
//
// Fire-and-forget: a logging failure must NEVER crash the calling function. The
// insert error is swallowed (console.error only) so the main job always finishes.
// Always use the service-role client (audit_logs has no frontend write policy).
//
// Conventions:
//   - `summary` is plain English for the client — no UUIDs, no jargon.
//   - For loops over entities, call writeAuditLog once per entity so a failure
//     pinpoints the exact shift/cleaner.
//   - Populate shift_id / booking_id / cleaner_id whenever relevant so the UI
//     can resolve them to names.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type AuditStatus = "success" | "failed" | "skipped" | "warning";
export type AuditTrigger = "cron" | "webhook" | "manual" | "system";

export interface AuditLogEntry {
  event_type: string;
  event_label: string;
  status: AuditStatus;
  summary: string;
  detail?: Record<string, unknown>;
  error_message?: string;
  source: string;
  shift_id?: string;
  booking_id?: string;
  cleaner_id?: string;
  triggered_by: AuditTrigger;
}

export async function writeAuditLog(
  client: SupabaseClient,
  entry: AuditLogEntry,
): Promise<void> {
  try {
    const { error } = await client.from("audit_logs").insert(entry);
    if (error) console.error("Audit log write failed:", error.message);
  } catch (e) {
    // Never let audit logging crash the main function.
    console.error("Audit log write threw:", e);
  }
}

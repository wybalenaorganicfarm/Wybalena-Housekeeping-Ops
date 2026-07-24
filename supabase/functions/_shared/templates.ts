// Message-template loader for Edge Functions.
//
// The core cleaner WhatsApp messages live in the `message_templates` table so an
// Admin / Operations Manager can reword them from the app. Every send site loads
// its template here and renders {{placeholders}} against the runtime values.
//
// SAFETY: loadTemplate returns null on any miss (row absent, table not yet
// migrated, query error). Callers pass their built-in copy as the fallback, so a
// message can never fail to send because a template was deleted — the DB row only
// ever *overrides* the code default.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface TemplateButton {
  id: string;
  title: string;
}

export interface MessageTemplate {
  key: string;
  body: string;
  header: string | null;
  footer: string | null;
  fallback: string | null;
  buttons: TemplateButton[] | null;
}

// Substitute {{var}} placeholders. Unknown / null vars render empty — a template
// edit that references a bad variable must degrade gracefully, never throw.
export function fillVars(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

// Load one template by key, or null if it isn't available for any reason.
export async function loadTemplate(
  sb: SupabaseClient,
  key: string,
): Promise<MessageTemplate | null> {
  try {
    const { data } = await sb
      .from("message_templates")
      .select("key, body, header, footer, fallback, buttons")
      .eq("key", key)
      .maybeSingle();
    return (data as MessageTemplate | null) ?? null;
  } catch {
    return null;
  }
}

// Resolve a button title from the template (by button id), falling back to the
// caller's default. Keeps the interactive payload id fixed in code while letting
// the visible label be edited.
export function btnTitle(
  t: MessageTemplate | null,
  id: string,
  dflt: string,
): string {
  return t?.buttons?.find((b) => b.id === id)?.title ?? dflt;
}

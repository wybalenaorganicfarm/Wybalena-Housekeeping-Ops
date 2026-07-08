// Turn a raw backend error into something safe to show a user. Curated,
// human-readable messages from our Edge Functions (e.g. "Cleaner not found")
// pass through unchanged; only raw Postgres / PostgREST / infra errors get
// mapped to a friendly line so DB internals never reach the screen.
export function friendlyError(raw?: string | null): string {
  const fallback = "Something went wrong. Please try again.";
  const msg = String(raw ?? "").trim();
  if (!msg) return fallback;
  const low = msg.toLowerCase();

  // Auth / session
  if (low.includes("jwt") || low.includes("token is expired") || low.includes("invalid token") ||
      low.includes("not authenticated") || low.includes("auth session missing"))
    return "Your session has expired. Please sign in again and try once more.";
  if (low.includes("forbidden") || low.includes("permission denied") ||
      low.includes("row-level security") || low.includes("42501"))
    return "You don't have permission to do that.";

  // Connectivity / function transport
  if (low.includes("failed to fetch") || low.includes("networkerror") ||
      low.includes("load failed") || low.includes("timeout") || low.includes("timed out"))
    return "Couldn't reach the server. Check your connection and try again.";
  if (low.includes("non-2xx") || low.includes("edge function returned"))
    return fallback;

  // Postgres constraint violations
  if (low.includes("duplicate key") || low.includes("23505") || low.includes("already exists"))
    return "That already exists — it looks like a duplicate.";
  if (low.includes("violates foreign key") || low.includes("23503"))
    return "This is still linked to other records, so it can't be changed or removed.";
  if (low.includes("null value") || low.includes("23502") || low.includes("not-null"))
    return "A required field is missing. Please fill everything in and try again.";
  if (low.includes("violates check constraint") || low.includes("23514") ||
      low.includes("invalid input syntax") || low.includes("22p02"))
    return "One of the values isn't valid. Please review and try again.";

  // Anything that still smells like raw DB / stack / technical output → hide it.
  if (/\b(sql|pgrst|postgres|constraint|relation|violates|column|syntax|exception|undefined is not|cannot read)\b/i.test(msg) ||
      msg.length > 160)
    return fallback;

  // Looks like a curated, human-readable message — keep it as-is.
  return msg;
}

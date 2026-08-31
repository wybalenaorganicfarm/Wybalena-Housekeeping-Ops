// Coerce any thrown value / supabase-js error object into a NON-EMPTY string.
//
// supabase-js can hand back an error whose `message` is empty — notably on
// head/count requests, where there's no response body to parse. An empty detail
// is corrosive to health reporting: health-check's diagnose() falls through to
// its generic "unexpected error" branch and the alert email's "Technical
// detail" line renders blank, so the reader is told something is broken and
// given nothing to act on. That is exactly what happened on 28 Aug 2026 — a
// false "App Database" outage alert with an empty technical detail.
//
// Shared by health-check and get-connection-status so the two DB probes report
// failures identically.
export function describeError(e: unknown): string {
  if (!e) return "unknown error (no detail reported)";
  if (typeof e === "string") return e || "unknown error (empty message)";
  const o = e as Record<string, unknown>;
  const parts = [o.message, o.code, o.details, o.hint]
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (parts.length) return parts.join(" | ");
  try {
    const j = JSON.stringify(e);
    if (j && j !== "{}") return j;
  } catch { /* not serialisable — fall through */ }
  return `unknown error (${Object.prototype.toString.call(e)}, no message)`;
}

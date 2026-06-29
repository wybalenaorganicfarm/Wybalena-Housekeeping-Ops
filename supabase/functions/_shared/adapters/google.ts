// Google OAuth helper — one OAuth client covers both Gmail (gmail.send) and
// Calendar (calendar.readonly), per Spec §3. We store a long-lived refresh token
// and exchange it for a short-lived access token at runtime.
//
// Env:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN   — obtained once via the OAuth consent flow with both scopes
//
// Returns null when creds are absent (adapters stay stubbed).

let cached: { token: string; expiresAt: number } | null = null;

export function googleConfigured(): boolean {
  return !!(
    Deno.env.get("GOOGLE_CLIENT_ID") &&
    Deno.env.get("GOOGLE_CLIENT_SECRET") &&
    Deno.env.get("GOOGLE_REFRESH_TOKEN")
  );
}

export async function getGoogleAccessToken(): Promise<string | null> {
  if (!googleConfigured()) return null;
  // Reuse within an invocation if still valid (>60s headroom).
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error(`[google] token exchange failed ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

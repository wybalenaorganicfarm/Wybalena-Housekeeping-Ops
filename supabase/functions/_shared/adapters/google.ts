// Google OAuth helper — one OAuth client covers both Gmail (gmail.send) and
// Calendar (calendar.readonly), per Spec §3. We store a long-lived refresh token
// and exchange it for a short-lived access token at runtime.
//
// The refresh token now lives in the DB (public.integration_tokens, written by the
// one-click reconnect flow) and takes priority over the GOOGLE_REFRESH_TOKEN env,
// which remains as a seed/fallback. This lets an admin re-authorise from the portal
// without redeploying secrets.
//
// Env:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN   — optional fallback; the DB token wins when present
//
// Returns null when creds are absent (adapters stay stubbed).
import { serviceClient } from "../client.ts";

let cached: { token: string; expiresAt: number } | null = null;

// The OAuth CLIENT (id + secret) must be present for any Google call. The refresh
// token can arrive later via the portal reconnect, so it's checked separately.
export function googleConfigured(): boolean {
  return !!(Deno.env.get("GOOGLE_CLIENT_ID") && Deno.env.get("GOOGLE_CLIENT_SECRET"));
}

// DB-stored refresh token (set via one-click reconnect) wins; env is the fallback.
async function getRefreshToken(): Promise<string | null> {
  try {
    const sb = serviceClient();
    const { data } = await sb
      .from("integration_tokens")
      .select("refresh_token")
      .eq("provider", "google")
      .maybeSingle();
    if (data?.refresh_token) return data.refresh_token;
  } catch (_e) {
    // DB unreachable — fall through to the env seed so we degrade, not crash.
  }
  return Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? null;
}

export async function getGoogleAccessToken(): Promise<string | null> {
  if (!googleConfigured()) return null;
  // Reuse within an invocation if still valid (>60s headroom).
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
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

// Shared constants for the Google reconnect flow, used by both google-oauth-start
// (builds the consent URL) and google-oauth-callback (exchanges the code). Keeping
// the scopes and redirect URI in one place guarantees the two ends stay in sync —
// Google requires the redirect_uri on the token exchange to match the auth request.

// gmail.send + calendar.readonly are what the app actually uses; openid + email
// let us show WHICH Google account is connected in the portal.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// The callback URL Google redirects to. Must be added ONCE to the OAuth client's
// "Authorized redirect URIs" in Google Cloud Console. Derived from SUPABASE_URL so
// it's correct per-project with no extra config.
export function redirectUri(): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  return `${base}/functions/v1/google-oauth-callback`;
}

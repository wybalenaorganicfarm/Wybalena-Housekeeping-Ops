// google-oauth-callback — PUBLIC (verify_jwt = false). Google redirects the admin's
// browser here after they approve the consent screen. We verify the signed state,
// exchange the auth code for a refresh token, store it in integration_tokens, and
// show a small self-closing success page. The popup closing is what tells the
// portal to refresh its connection status.
import { serviceClient } from "../_shared/client.ts";
import { readState } from "../_shared/oauthState.ts";
import { redirectUri } from "../_shared/googleOauth.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "google-oauth-callback";

// Supabase serves Edge Function responses on the *.supabase.co domain as
// text/plain + X-Content-Type-Options: nosniff (anti-phishing) — so an HTML page
// returned from here renders as raw source and its <script> never runs, meaning the
// popup never postMessages the result and the portal buffers forever. Instead we
// 302-redirect to a real static page on the APP origin (Vercel), which IS served as
// HTML, so its script executes, relays {source,ok}, and closes the popup.
function result(origin: string | undefined, ok: boolean, extra?: { email?: string | null; reason?: string }): Response {
  // No trusted origin (invalid/expired state) → we can't safely redirect. Dead-end
  // with a plain message; the user just restarts from the portal.
  if (!origin) {
    return new Response(
      ok ? "Google connected. You can close this window." : "This link is invalid or expired. Please start again from the portal.",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const u = new URL("/google-oauth-result.html", origin);
  u.searchParams.set("ok", ok ? "1" : "0");
  if (extra?.email) u.searchParams.set("email", extra.email);
  if (extra?.reason) u.searchParams.set("reason", extra.reason);
  return Response.redirect(u.toString(), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  // Read state early so we can message the correct app origin even on failure.
  const st = await readState(params.get("state"));
  const origin = st?.origin;

  // The user denied consent, or Google returned an error.
  const oauthErr = params.get("error");
  if (oauthErr) {
    return result(origin, false, { reason: "denied" });
  }

  const code = params.get("code");
  if (!code || !st) {
    return result(origin, false, { reason: "expired" });
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return result(origin, false, { reason: "config" });
  }

  // Exchange the auth code for tokens. redirect_uri MUST match the one used to
  // start the flow, or Google rejects the exchange.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error(`[google-oauth-callback] token exchange failed ${tokenRes.status}: ${await tokenRes.text()}`);
    return result(origin, false, { reason: "exchange" });
  }
  const tokens = await tokenRes.json();
  const refreshToken: string | undefined = tokens.refresh_token;
  if (!refreshToken) {
    // Happens if the account was previously approved and Google didn't re-issue a
    // refresh token. We force prompt=consent on start to avoid this, but guard anyway.
    return result(origin, false, { reason: "norefresh" });
  }

  // Best-effort: which account did they connect? (openid + email scopes).
  let email: string | null = null;
  try {
    const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (who.ok) email = (await who.json())?.email ?? null;
  } catch (_e) { /* non-fatal — we just won't show the email */ }

  const sb = serviceClient();
  const { error } = await sb.from("integration_tokens").upsert({
    provider: "google",
    refresh_token: refreshToken,
    connected_email: email,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });

  if (error) {
    console.error(`[google-oauth-callback] failed to store token: ${error.message}`);
    return result(origin, false, { reason: "save" });
  }

  await writeAuditLog(sb, {
    event_type: "integration.google_reconnected",
    event_label: "Google Reconnected",
    status: "success",
    summary: `Google account${email ? ` (${email})` : ""} reconnected. Gmail sending and Calendar sync are re-authorised.`,
    detail: { connected_email: email },
    source: SOURCE,
    triggered_by: "manual",
  });

  return result(origin, true, { email });
});

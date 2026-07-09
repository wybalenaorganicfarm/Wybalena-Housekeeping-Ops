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

// Render the result page AND postMessage {source,ok} to the app window that opened
// this popup, so the portal knows the TRUE outcome (not just "the popup closed").
function page(title: string, message: string, ok: boolean, origin?: string): Response {
  const color = ok ? "#256b43" : "#a8392b";
  const target = origin ? JSON.stringify(origin) : '"*"';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;font-family:Helvetica,Arial,sans-serif;background:#eef0ee;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="background:#fff;border:1px solid #e4e7e3;border-radius:14px;padding:34px 30px;max-width:400px;text-align:center;box-shadow:0 12px 32px -12px rgba(20,30,25,.35);">
    <div style="font-size:40px;line-height:1;margin-bottom:12px;">${ok ? "✅" : "⚠️"}</div>
    <div style="font-size:18px;font-weight:700;color:${color};margin-bottom:8px;">${title}</div>
    <div style="font-size:13.5px;color:#5d665f;line-height:1.55;">${message}</div>
    <button onclick="window.close()" style="margin-top:20px;background:#1f5c46;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13.5px;font-weight:600;cursor:pointer;">Close this window</button>
  </div>
  <script>
    try { if (window.opener) window.opener.postMessage({ source: "google-oauth", ok: ${ok} }, ${target}); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, ${ok ? 1500 : 6000});
  </script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
    return page("Couldn't connect", `Google reported: ${oauthErr}. You can close this window and try again.`, false, origin);
  }

  const code = params.get("code");
  if (!code || !st) {
    return page("Link expired", "This reconnect link is invalid or has expired. Please start again from the portal.", false, origin);
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return page("Not configured", "The Google OAuth client isn't set up on the server. Contact your administrator.", false, origin);
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
    return page("Couldn't connect", "Google refused the sign-in (the code may have expired). Please try again.", false, origin);
  }
  const tokens = await tokenRes.json();
  const refreshToken: string | undefined = tokens.refresh_token;
  if (!refreshToken) {
    // Happens if the account was previously approved and Google didn't re-issue a
    // refresh token. We force prompt=consent on start to avoid this, but guard anyway.
    return page(
      "Almost there",
      "Google didn't return a long-lived token. Please remove this app's access at myaccount.google.com/permissions, then reconnect.",
      false,
      origin,
    );
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
    return page("Couldn't save", "The connection succeeded but we couldn't save it. Please try again.", false, origin);
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

  return page("Google connected", `${email ? `${email} is` : "Your Google account is"} now linked. You can close this window — the portal will update automatically.`, true, origin);
});

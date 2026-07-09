// google-oauth-start — app-facing (admin only). Returns the Google consent URL the
// portal opens in a popup. After the user picks an account and approves, Google
// redirects to google-oauth-callback with an auth code. verify_jwt = true.
import { serviceClient } from "../_shared/client.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { signState } from "../_shared/oauthState.ts";
import { GOOGLE_SCOPES, redirectUri } from "../_shared/googleOauth.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return json({ error: "Google OAuth client is not configured (GOOGLE_CLIENT_ID missing)." }, 400);
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  // offline + consent forces Google to return a refresh_token every time (without
  // prompt=consent a re-auth of an already-approved account omits it).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", await signState());

  return json({ url: url.toString() });
});

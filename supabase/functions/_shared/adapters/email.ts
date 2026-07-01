// Email adapter — Gmail API (send as a real Gmail account via OAuth).
// THIN + SWAPPABLE.
//
// ── SWAP POINT ───────────────────────────────────────────────────────────────
// Stubbed: logs instead of sending until Gmail OAuth creds are set. To go live,
// provide a valid OAuth access token with scope `gmail.send` (refresh-token
// exchange omitted here for brevity — wire it where marked).
//
// Env:
//   GMAIL_SENDER     — the account that sends (e.g. ops@wybalena.com)   [confirmed: Gmail]
//   ALERT_EMAIL_TO   — Ashley's inbox (default recipient for alerts)
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN — see google.ts
import { getGoogleAccessToken, googleConfigured } from "./google.ts";

export interface EmailResult {
  ok: boolean;
  stubbed?: boolean;
}

export interface HealthResult {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

// Connection probe that works with a SEND-ONLY token. We don't call any Gmail
// data endpoint (users.getProfile etc. need a read scope this token doesn't have
// and would 403). Instead:
//   1. exchange the refresh token → access token  (proves the login still works)
//   2. call Google's OAuth tokeninfo on that token (works with any scope) and
//      confirm the send scope is present         (proves sending will work)
// Sends no email. Returns configured:false when creds are absent.
export async function checkHealth(): Promise<HealthResult> {
  const sender = Deno.env.get("GMAIL_SENDER");
  if (!sender || !googleConfigured()) {
    return { name: "gmail", configured: false, ok: false, detail: "GMAIL_SENDER / GOOGLE_* OAuth creds not set" };
  }
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return { name: "gmail", configured: true, ok: false, detail: "refresh-token exchange failed — the Google login needs reconnecting" };
  }
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      return { name: "gmail", configured: true, ok: false, detail: `token check failed — HTTP ${res.status}: ${await res.text()}` };
    }
    const info = await res.json().catch(() => ({}));
    const scopes = String((info as { scope?: string }).scope ?? "");
    // gmail.send, or full-access mail.google.com, both allow sending.
    const canSend = /gmail\.send|mail\.google\.com/.test(scopes);
    return canSend
      ? { name: "gmail", configured: true, ok: true, detail: "token valid, send scope present" }
      : { name: "gmail", configured: true, ok: false, detail: `token valid but missing the gmail.send scope (has: ${scopes || "none"})` };
  } catch (e) {
    return { name: "gmail", configured: true, ok: false, detail: String(e) };
  }
}

// Subject headers must be ASCII; RFC 2047-encode when they contain non-ASCII
// (em-dash, emoji, accents) so mail clients don't mojibake them.
function encodeSubject(subject: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const bytes = new TextEncoder().encode(subject);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

export async function sendEmail(
  subject: string,
  body: string,
  to?: string,
  html?: string,
): Promise<EmailResult> {
  const sender = Deno.env.get("GMAIL_SENDER");
  const recipient = to ?? Deno.env.get("ALERT_EMAIL_TO");
  const accessToken = await getGoogleAccessToken();

  // ── SWAP POINT: stub until creds exist ─────────────────────────────────────
  if (!sender || !recipient || !accessToken) {
    console.log(`[email:STUB] to=${recipient ?? "?"} subject="${subject}"\n${html ?? body}`);
    return { ok: true, stubbed: true };
  }

  // RFC 2822 message, base64url-encoded, posted to the Gmail send endpoint.
  // When `html` is provided, send an HTML body (buttons/tables); otherwise plain text.
  const raw = [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    html ? "Content-Type: text/html; charset=UTF-8" : "Content-Type: text/plain; charset=UTF-8",
    "",
    html ?? body,
  ].join("\r\n");
  // btoa() only handles Latin1; encode UTF-8 bytes first so non-ASCII (em-dash,
  // emoji, accents) in the subject/body don't throw.
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const encoded = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    },
  );
  if (!res.ok) {
    console.error(`[email] send failed ${res.status}: ${await res.text()}`);
    return { ok: false };
  }
  return { ok: true };
}

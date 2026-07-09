// Signed, short-lived state for the Google OAuth reconnect flow.
//
// google-oauth-start is admin-gated, but google-oauth-callback is public (Google
// redirects the browser there with no Supabase JWT). The `state` param is our
// proof that the callback belongs to a flow WE initiated: start signs a payload
// (timestamp + nonce + the app's origin) with CONFIRM_LINK_SECRET, callback
// recomputes and rejects mismatches or anything older than TTL. This blocks CSRF /
// replayed callbacks. The origin is carried so the callback can postMessage the
// result back to the exact app window that opened it.

const enc = new TextEncoder();
const TTL_MS = 15 * 60_000; // a consent flow should complete well within 15 min

function secret(): string {
  return Deno.env.get("CONFIRM_LINK_SECRET") ?? "dev-insecure-confirm-secret";
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToStr(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StatePayload { ts: number; nonce: string; origin?: string }

// state = base64url(JSON{ts,nonce,origin}) + "." + hmacHex(payload)
export async function signState(extra: { origin?: string } = {}): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = b64url(enc.encode(JSON.stringify({ ts: Date.now(), nonce, ...extra })));
  const sig = await hmacHex(payload);
  return `${payload}.${sig}`;
}

// Constant-time compare so a mismatch doesn't leak position via early exit.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify the signature + TTL and return the decoded payload, or null if invalid.
export async function readState(state: string | null): Promise<StatePayload | null> {
  if (!state || !state.includes(".")) return null;
  const [payload, sig] = state.split(".");
  if (!timingSafeEqual(sig, await hmacHex(payload))) return null;
  try {
    const parsed = JSON.parse(b64urlToStr(payload)) as StatePayload;
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts >= TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

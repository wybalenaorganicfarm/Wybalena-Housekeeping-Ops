// Signed, short-lived state for the Google OAuth reconnect flow.
//
// google-oauth-start is admin-gated, but google-oauth-callback is public (Google
// redirects the browser there with no Supabase JWT). The `state` param is our
// proof that the callback belongs to a flow WE initiated: start signs a nonce +
// timestamp with CONFIRM_LINK_SECRET, callback recomputes and rejects mismatches
// or anything older than TTL. This blocks CSRF / replayed callbacks.

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

// state = base64url(JSON{ts,nonce}) + "." + hmacHex(payload)
export async function signState(): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = b64url(enc.encode(JSON.stringify({ ts: Date.now(), nonce })));
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

export async function verifyState(state: string | null): Promise<boolean> {
  if (!state || !state.includes(".")) return false;
  const [payload, sig] = state.split(".");
  if (!timingSafeEqual(sig, await hmacHex(payload))) return false;
  try {
    const { ts } = JSON.parse(b64urlToStr(payload)) as { ts: number };
    return typeof ts === "number" && Date.now() - ts < TTL_MS;
  } catch {
    return false;
  }
}

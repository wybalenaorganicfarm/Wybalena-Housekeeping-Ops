// Signed one-click confirm links for the shift-confirmation email.
//
// The email's "Confirm Shift" button is a plain <a href> that anyone with the URL
// could hit, so each link carries an HMAC-SHA256 signature over the shift id keyed
// by CONFIRM_LINK_SECRET. The public confirm-shift-email endpoint recomputes the
// signature and rejects mismatches. No expiry — a shift only confirms once (the
// endpoint is idempotent), so a leaked link can't do harm beyond that.

const enc = new TextEncoder();

function secret(): string {
  return Deno.env.get("CONFIRM_LINK_SECRET") ?? "dev-insecure-confirm-secret";
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function signShift(shiftId: string): Promise<string> {
  return hmacHex(shiftId);
}

// Constant-time compare so a mismatch doesn't leak position via early exit.
export async function verifyShift(shiftId: string, token: string): Promise<boolean> {
  const expected = await hmacHex(shiftId);
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

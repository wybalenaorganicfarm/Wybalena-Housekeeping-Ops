// send-auth-email — Supabase Auth "Send Email" hook (HTTPS type).
// When the hook is enabled, Supabase STOPS sending its own auth emails and calls
// this function instead, handing over the recipient + a one-time token. We build
// the branded email and send it through our own Gmail adapter, so the sender is
// GMAIL_SENDER (e.g. ops@wybalena.com) — never Supabase's shared address.
//
// SECURITY: verify_jwt = false (Auth calls this server-side with no user JWT), so
// the ONLY authentication is the Standard Webhooks signature keyed by
// SEND_EMAIL_HOOK_SECRET. We fail CLOSED: no/invalid secret or bad signature → reject.
//
// The hook fires for EVERY auth email event (invite, recovery, magiclink, …). This
// app only uses `invite` (new-user provisioning) and `recovery` (password reset);
// anything else gets a safe generic fallback so the hook never crashes.
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { sendEmail } from "../_shared/adapters/email.ts";
import { inviteEmail, passwordResetEmail, genericAuthEmail } from "../_shared/emailTemplates.ts";

interface HookPayload {
  user: { email: string; user_metadata?: { full_name?: string | null } | null };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string; // invite | recovery | magiclink | signup | email_change | reauthentication
    site_url: string;
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Supabase's verify endpoint consumes the one-time token and then redirects the
// browser to redirect_to with a session — landing on the app's #type=invite /
// #type=recovery gate. token_hash + redirect_to are URL-encoded so they survive
// as query values.
function verifyUrl(d: HookPayload["email_data"]): string {
  const base = Deno.env.get("SUPABASE_URL");
  const t = encodeURIComponent(d.token_hash);
  const type = encodeURIComponent(d.email_action_type);
  const rt = encodeURIComponent(d.redirect_to);
  return `${base}/auth/v1/verify?token=${t}&type=${type}&redirect_to=${rt}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: { http_code: 405, message: "method not allowed" } }, 405);

  // 1) Authenticate the request via the Standard Webhooks signature. Fail closed.
  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!secret) {
    console.error("[send-auth-email] SEND_EMAIL_HOOK_SECRET is not set — refusing to send unauthenticated");
    return reply({ error: { http_code: 500, message: "email hook not configured" } }, 500);
  }

  const raw = await req.text();
  let payload: HookPayload;
  try {
    const wh = new Webhook(secret.replace("v1,whsec_", ""));
    // Throws on a missing/invalid signature; returns the verified, parsed body.
    payload = wh.verify(raw, Object.fromEntries(req.headers)) as HookPayload;
  } catch (e) {
    console.error(`[send-auth-email] signature verification failed: ${e}`);
    return reply({ error: { http_code: 401, message: "invalid signature" } }, 401);
  }

  const to = payload.user?.email;
  const name = payload.user?.user_metadata?.full_name ?? null;
  const data = payload.email_data;
  if (!to || !data?.token_hash || !data?.email_action_type) {
    return reply({ error: { http_code: 400, message: "malformed hook payload" } }, 400);
  }

  // 2) Build the branded email for this action type.
  const url = verifyUrl(data);
  let mail: { subject: string; text: string; html: string };
  switch (data.email_action_type) {
    case "invite":
      mail = inviteEmail({ name, acceptUrl: url });
      break;
    case "recovery":
      mail = passwordResetEmail({ name, resetUrl: url });
      break;
    default:
      // magiclink / signup / email_change / reauthentication — not used by this
      // app today, but handled so a stray event never 500s the auth flow.
      mail = genericAuthEmail({ name, actionUrl: url, token: data.token });
  }

  // 3) Send via our own Gmail adapter. On a genuine send failure surface a 500 so
  // the failure reaches the admin (a swallowed 200 would silently drop the invite);
  // a stubbed send (creds absent, dev) counts as success and does not block.
  const result = await sendEmail(mail.subject, mail.text, to, mail.html);
  if (!result.ok) {
    console.error(`[send-auth-email] send failed for action=${data.email_action_type} to=${to}`);
    return reply({ error: { http_code: 500, message: "failed to send email" } }, 500);
  }

  return reply({});
});

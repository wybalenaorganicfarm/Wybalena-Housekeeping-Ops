// WhatsApp adapter — Whapi (Whapi.Cloud).
// THIN + SWAPPABLE. Business logic must never import a provider SDK directly.
//
// ── SWAP POINT ───────────────────────────────────────────────────────────────
// Stubbed: logs instead of calling Whapi until WHAPI_TOKEN is set. To go live,
// set env WHAPI_TOKEN (+ optionally WHAPI_BASE_URL) and the fetch below runs.
//
// Baseline = keyword/text replies ("YES <code>" / "NO <code>" / "CANCEL <code>")
// because the Whapi plan may not support native interactive buttons. Each
// outbound offer carries a short offer_code so the inbound reply maps back to
// the exact shift_assignments row (see correlation in whatsapp-inbound).

const WHAPI_BASE = Deno.env.get("WHAPI_BASE_URL") ?? "https://gate.whapi.cloud";

// Whapi addresses chats as "<digits>@s.whatsapp.net". Accept a raw phone number
// and normalize; pass through anything that already looks like a chat id.
function toChatId(to: string): string {
  if (to.includes("@")) return to;
  return `${to.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  stubbed?: boolean;
}

export async function sendMessage(
  toPhone: string,
  body: string,
): Promise<SendResult> {
  const token = Deno.env.get("WHAPI_TOKEN");

  // ── SWAP POINT: stub until creds exist ─────────────────────────────────────
  if (!token) {
    console.log(`[whatsapp:STUB] -> ${toPhone}\n${body}`);
    return { ok: true, stubbed: true };
  }

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: toChatId(toPhone), body }),
  });
  if (!res.ok) {
    console.error(`[whatsapp] send failed ${res.status}: ${await res.text()}`);
    return { ok: false };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, providerMessageId: data?.message?.id ?? data?.id };
}

// Quick-reply button. `id` is the machine payload echoed back on the inbound
// webhook (e.g. "accept:<assignmentId>"); `title` is what the cleaner sees.
export interface QuickReply {
  id: string;
  title: string;
}

// Send an interactive button message (Whapi /messages/interactive). Falls back
// to a plain-text keyword message when buttons aren't available (stub or no
// token), so the keyword path keeps working as a safety net.
export async function sendButtons(
  toPhone: string,
  body: string,
  buttons: QuickReply[],
  opts: { header?: string; footer?: string; fallbackText?: string } = {},
): Promise<SendResult> {
  const token = Deno.env.get("WHAPI_TOKEN");
  if (!token) {
    console.log(`[whatsapp:STUB] -> ${toPhone}\n${body}\n[buttons] ${buttons.map((b) => `${b.title}=${b.id}`).join(" · ")}`);
    return { ok: true, stubbed: true };
  }

  const res = await fetch(`${WHAPI_BASE}/messages/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: toChatId(toPhone),
      type: "button",
      ...(opts.header ? { header: { text: opts.header } } : {}),
      body: { text: body },
      ...(opts.footer ? { footer: { text: opts.footer } } : {}),
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: "quick_reply", title: b.title, id: b.id })),
      },
    }),
  });
  if (!res.ok) {
    console.error(`[whatsapp] interactive send failed ${res.status}: ${await res.text()}`);
    // Fall back to a keyword text so the offer still reaches the cleaner.
    return opts.fallbackText ? sendMessage(toPhone, opts.fallbackText) : { ok: false };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, providerMessageId: data?.message?.id ?? data?.id };
}

// Parse an inbound Whapi webhook payload into a normalized reply.
// Keyword baseline: first token = action, optional second token = offer code.
// If the Whapi plan supports interactive buttons, map the button payload here.
export interface InboundReply {
  providerMessageId: string;
  fromPhone: string;
  action: "accept" | "decline" | "cancel" | "unknown";
  offerCode: string | null;
  // Set when the reply came from a quick-reply button whose payload encoded the
  // assignment row id (e.g. "accept:<uuid>"). Lets the webhook skip phone/code
  // correlation and act on the exact offer.
  assignmentId: string | null;
  rawText: string;
}

const ACTION_FROM_KEYWORD: Record<string, InboundReply["action"]> = {
  YES: "accept", ACCEPT: "accept", Y: "accept", "1": "accept",
  NO: "decline", DECLINE: "decline", N: "decline", "2": "decline",
  CANCEL: "cancel", C: "cancel", "3": "cancel",
};

// Pull a button payload id out of the several shapes Whapi/WhatsApp may use.
function buttonPayload(m: Record<string, unknown>): string | null {
  const r = m.reply as Record<string, Record<string, unknown>> | undefined;
  const i = m.interactive as Record<string, Record<string, unknown>> | undefined;
  const b = m.button as Record<string, unknown> | undefined;
  const a = m.action as Record<string, unknown> | undefined;
  return (
    (r?.buttons_reply?.id as string) ??
    (i?.button_reply?.id as string) ??
    (b?.id as string) ?? (b?.payload as string) ??
    (a?.id as string) ?? null
  ) || null;
}

// The human-readable title of the tapped button (e.g. "✅ Accept").
function buttonTitle(m: Record<string, unknown>): string {
  const r = m.reply as Record<string, Record<string, unknown>> | undefined;
  const i = m.interactive as Record<string, Record<string, unknown>> | undefined;
  const b = m.button as Record<string, unknown> | undefined;
  return String(
    (r?.buttons_reply?.title as string) ??
    (i?.button_reply?.title as string) ??
    (b?.text as string) ?? (b?.title as string) ?? "",
  );
}

// Map any free text/title to an action (handles "✅ Accept", "YES", "1", etc).
function actionFromText(s: string): InboundReply["action"] {
  const u = s.toUpperCase();
  if (/\bACCEPT\b|\bYES\b|^Y$|\b1\b/.test(u)) return "accept";
  if (/\bDECLINE\b|\bNO\b|^N$|\b2\b/.test(u)) return "decline";
  if (/\bCANCEL\b|^C$|\b3\b/.test(u)) return "cancel";
  return "unknown";
}

// Read-only connection probe — hits Whapi's /health endpoint. Does NOT send any
// message. Returns configured:false when no token is set (adapter still stubbed).
export interface HealthResult {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

export async function checkHealth(): Promise<HealthResult> {
  const token = Deno.env.get("WHAPI_TOKEN");
  if (!token) return { name: "whapi", configured: false, ok: false, detail: "WHAPI_TOKEN not set" };
  try {
    const res = await fetch(`${WHAPI_BASE}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      name: "whapi",
      configured: true,
      ok: res.ok,
      detail: res.ok ? "channel reachable" : `HTTP ${res.status}: ${await res.text()}`,
    };
  } catch (e) {
    return { name: "whapi", configured: true, ok: false, detail: String(e) };
  }
}

// True when the message is from a group chat (Whapi group ids end in "@g.us").
// Group chatter must NEVER be treated as an offer reply.
function isGroupMessage(m: Record<string, unknown>): boolean {
  const chat = String(m.chat_id ?? m.from ?? "");
  return chat.includes("@g.us") || chat.includes("@g.whatsapp.net") ||
    m.type === "group" || Boolean(m.group_id);
}

export function parseInbound(payload: unknown): InboundReply[] {
  // Whapi posts { messages: [{ id, from, text: { body }, type, ... }] }
  const out: InboundReply[] = [];
  const messages = (payload as { messages?: unknown[] })?.messages ?? [];
  for (const m of messages as Record<string, unknown>[]) {
    // ── FILTER: only act on genuine inbound replies ──────────────────────────
    // Skip our own outgoing messages (Whapi echoes them with from_me:true) and
    // anything from a group chat. Without this the bot replies to every message
    // it sees — including normal group conversation. (Spec §7.5 — inbound is
    // cleaner offer replies only.)
    if (m.from_me === true || isGroupMessage(m)) continue;

    const text =
      ((m.text as Record<string, unknown>)?.body as string) ??
      (m.body as string) ??
      "";

    let action: InboundReply["action"] = "unknown";
    let assignmentId: string | null = null;
    let offerCode: string | null = null;

    // Preferred path: interactive quick-reply button.
    const payload = buttonPayload(m);
    if (payload) {
      const tagged = payload.match(/^(accept|decline|cancel)[:|](.+)$/i);
      if (tagged) {
        // Our scheme: action encoded in the payload ("accept:<assignmentId>").
        action = tagged[1].toLowerCase() as InboundReply["action"];
        assignmentId = tagged[2];
      } else {
        // Make-style: payload is a bare id, action conveyed by the button title.
        assignmentId = payload;
        action = actionFromText(buttonTitle(m));
      }
    } else {
      // Fallback path: keyword text ("YES <code>" / "NO <code>" / "CANCEL <code>").
      const tokens = text.trim().toUpperCase().split(/\s+/);
      action = ACTION_FROM_KEYWORD[tokens[0] ?? ""] ?? "unknown";
      offerCode = tokens.slice(1).find((t) => /^[0-9]{3,6}$/.test(t)) ?? null;
    }

    out.push({
      providerMessageId: String(m.id ?? ""),
      fromPhone: String(m.from ?? m.chat_id ?? ""),
      action,
      offerCode,
      assignmentId,
      rawText: text,
    });
  }
  return out;
}

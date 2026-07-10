// WhatsApp adapter — Whapi (Whapi.Cloud).
// THIN + SWAPPABLE. Business logic must never import a provider SDK directly.
//
// ── SWAP POINT ───────────────────────────────────────────────────────────────
// Stubbed: logs instead of calling Whapi until WHAPI_TOKEN is set. To go live,
// set env WHAPI_TOKEN (+ optionally WHAPI_BASE_URL) and the fetch below runs.
//
// Interactive buttons only — offers carry the assignment id in the button payload
// ("accept:<id>") so the inbound webhook maps a tap back to the exact
// shift_assignments row (see correlation in whatsapp-inbound). Free-typed keyword
// replies ("accept"/"decline") are still parsed as a fallback, but we never send
// short codes to cleaners.

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

// Send the "Are you sure you want to decline?" confirmation with Yes/No buttons
// whose payloads carry the assignment id. Returns the message id so the caller can
// store it for quoted-id matching of the Yes/No tap.
export function sendDeclineConfirm(
  toPhone: string,
  assignmentId: string,
): Promise<SendResult> {
  return sendButtons(
    toPhone,
    `Are you sure you want to decline?`,
    [
      // Titles carry the verb so a text-echoed tap (no interactive payload) is still
      // unambiguous vs the cancel confirmation's Yes/No. Keep ≤20 chars (WA limit).
      { id: `declineyes:${assignmentId}`, title: "✅ Yes, decline" },
      { id: `declineno:${assignmentId}`, title: "↩️ No, keep offer" },
    ],
    { footer: "Wybalena Organic Farm" },
  );
}

// Send the "Are you sure you want to cancel?" confirmation with Yes/No buttons
// whose payloads carry the assignment id. Returns the message id so the caller can
// store it for quoted-id matching of the Yes/No tap.
export function sendCancelConfirm(
  toPhone: string,
  assignmentId: string,
): Promise<SendResult> {
  return sendButtons(
    toPhone,
    `Are you sure you want to cancel?`,
    [
      // Distinct verbs from the decline confirmation so a text-echoed tap resolves
      // to cancel_confirm/cancel_cancel, not decline. Keep ≤20 chars (WA limit).
      { id: `cancelyes:${assignmentId}`, title: "✅ Yes, cancel" },
      { id: `cancelno:${assignmentId}`, title: "↩️ No, keep shift" },
    ],
    { footer: "Wybalena Organic Farm" },
  );
}

// Send the "Shift Accepted" confirmation with a single Cancel button, so a cleaner
// who accepted can later drop the shift from this message. The button payload
// carries the assignment id ("cancel:<id>"). Returns the message id so the caller
// can store it for quoted-id matching of the Cancel tap.
export function sendAcceptConfirm(
  toPhone: string,
  assignmentId: string,
): Promise<SendResult> {
  return sendButtons(
    toPhone,
    `Shift Accepted ✅`,
    [{ id: `cancel:${assignmentId}`, title: "🚫 Cancel" }],
    { footer: "Wybalena Organic Farm" },
  );
}

// Parse an inbound Whapi webhook payload into a normalized reply.
// Keyword baseline: first token = action, optional second token = offer code.
// If the Whapi plan supports interactive buttons, map the button payload here.
export type InboundAction =
  | "accept" | "decline" | "cancel"
  | "decline_confirm" | "decline_cancel"  // from the decline "Are you sure?" Yes/No buttons
  | "cancel_confirm" | "cancel_cancel"    // from the cancel "Are you sure?" Yes/No buttons
  | "unknown";

export interface InboundReply {
  providerMessageId: string;
  fromPhone: string;
  action: InboundAction;
  offerCode: string | null;
  // Set when the reply came from a quick-reply button whose payload encoded the
  // assignment row id (e.g. "accept:<uuid>"). Lets the webhook skip phone/code
  // correlation and act on the exact offer.
  assignmentId: string | null;
  // The id of the message this reply is quoting/replying to (Whapi context). We
  // store each offer's outbound message id on the assignment, so this maps a tap
  // back to the exact offer even with several open offers.
  quotedMessageId: string | null;
  rawText: string;
}

// Button payload verb → action. Offer buttons use accept/decline/cancel; the
// decline confirmation buttons use declineyes/declineno.
const TAG_ACTION: Record<string, InboundAction> = {
  accept: "accept", decline: "decline", cancel: "cancel",
  declineyes: "decline_confirm", declineno: "decline_cancel",
  cancelyes: "cancel_confirm", cancelno: "cancel_cancel",
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

// The id of the message this reply quotes/replies to. Whapi surfaces it under a
// `context` object (shapes vary by plan); we check the common fields.
function quotedMessageId(m: Record<string, unknown>): string | null {
  const ctx = m.context as Record<string, unknown> | undefined;
  const id = (ctx?.quoted_id ?? ctx?.id ?? ctx?.message_id ??
    m.quoted_id ?? m.reply_to ?? (m.quoted as Record<string, unknown> | undefined)?.id) as string | undefined;
  return id ? String(id) : null;
}

// Map any free text/title to an action (handles "✅ Yes, cancel", "YES 4823", "N", "1").
// Confirmation button titles are classified FIRST and by their verb, so a "No" tap
// on the CANCEL prompt ("No, keep shift") is never mistaken for a decline, and a "No"
// on the DECLINE prompt ("No, keep offer") is never mistaken for a cancel.
function actionFromText(s: string): InboundReply["action"] {
  const u = s.toUpperCase();
  const first = u.trim().split(/\s+/)[0] ?? "";
  // "Are you sure?" answers — verb-tagged, so both Yes and No are unambiguous.
  if (/\bYES\b/.test(u) && /\bCANCEL\b/.test(u)) return "cancel_confirm";
  if (/\bYES\b/.test(u) && /\bDECLINE\b/.test(u)) return "decline_confirm";
  if (/KEEP\s*SHIFT/.test(u) || (/\bNO\b/.test(u) && /\bSHIFT\b/.test(u))) return "cancel_cancel";
  if (/KEEP\s*OFFER/.test(u) || /GO\s*BACK/.test(u) || (/\bNO\b/.test(u) && /\bOFFER\b/.test(u))) return "decline_cancel";
  // Bare offer actions / legacy keyword replies.
  if (/\bACCEPT\b/.test(u) || first === "Y" || first === "1") return "accept";
  if (/\bCANCEL\b/.test(u) || first === "C" || first === "3") return "cancel";
  if (/\bDECLINE\b/.test(u) || first === "N" || first === "2") return "decline";
  // Bare YES/NO with no verb (keyword replies) — best-effort.
  if (/\bYES\b/.test(u)) return "accept";
  if (/\bNO\b/.test(u)) return "decline";
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
    if (!res.ok) {
      return { name: "whapi", configured: true, ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
    }
    // /health can return 200 while the channel is unauthorised (status "QR"), which
    // is exactly when sends fail with 401. Treat only AUTH as healthy so the portal
    // surfaces a "Reconnect WhatsApp" prompt instead of a false "Connected".
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    const st = data?.status;
    const text = String((typeof st === "object" && st ? (st as { text?: string }).text : st) ?? "").toUpperCase();
    if (!text) return { name: "whapi", configured: true, ok: true, detail: "channel reachable" };
    return {
      name: "whapi",
      configured: true,
      ok: text === "AUTH",
      detail: text === "AUTH" ? "channel authorised" : `channel needs authorisation (status: ${text})`,
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
      const tagged = payload.match(/^([a-z]+)[:|](.+)$/i);
      if (tagged && TAG_ACTION[tagged[1].toLowerCase()]) {
        // Our scheme: action encoded in the payload ("accept:<assignmentId>").
        action = TAG_ACTION[tagged[1].toLowerCase()];
        const id = tagged[2].trim();
        // Guard against a missing id ("accept:undefined") — fall back to open-offer
        // resolution downstream rather than looking up a bogus id.
        assignmentId = id && id !== "undefined" && id !== "null" ? id : null;
      } else {
        // Make-style: payload is a bare id, action conveyed by the button title.
        assignmentId = payload && payload !== "undefined" ? payload : null;
        action = actionFromText(buttonTitle(m) || payload);
      }
    } else {
      // Fallback path: free text. Covers both keyword replies ("YES 4823") and a
      // tapped button echoed by Whapi as plain text ("✅ Accept" / "Accept") when
      // the interactive payload isn't present. actionFromText handles titles,
      // emojis and keywords alike; the code is any 3–6 digit token in the message.
      action = actionFromText(text);
      const tokens = text.trim().toUpperCase().split(/\s+/);
      offerCode = tokens.find((t) => /^[0-9]{3,6}$/.test(t)) ?? null;
    }

    out.push({
      providerMessageId: String(m.id ?? ""),
      fromPhone: String(m.from ?? m.chat_id ?? ""),
      action,
      offerCode,
      assignmentId,
      quotedMessageId: quotedMessageId(m),
      rawText: text,
    });
  }
  return out;
}

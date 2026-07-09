// whatsapp-reconnect — app-facing (admin only). Powers the portal's "Reconnect
// WhatsApp" modal for the Whapi channel. verify_jwt = true.
//   action:"qr"      -> fresh login QR (data URL) to scan with WhatsApp
//   action:"status"  -> live channel status (poll until authorized)
//   action:"confirm" -> record the reconnection in the audit log (called once by
//                       the UI when it first sees the channel go AUTH)
import { serviceClient } from "../_shared/client.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getChannelStatus, getLoginQr } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "whatsapp-reconnect";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { action } = await req.json().catch(() => ({}));

  if (action === "status") {
    return json(await getChannelStatus());
  }

  if (action === "confirm") {
    await writeAuditLog(sb, {
      event_type: "integration.whatsapp_reconnected",
      event_label: "WhatsApp Reconnected",
      status: "success",
      summary: "WhatsApp channel reconnected. Shift offers and reminders can send again.",
      source: SOURCE,
      triggered_by: "manual",
    });
    return json({ ok: true });
  }

  // default: qr
  return json(await getLoginQr());
});

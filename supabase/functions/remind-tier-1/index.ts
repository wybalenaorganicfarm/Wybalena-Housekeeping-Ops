// remind-tier-1 — cron (admin-scheduled from /schedule). WhatsApp reminder to
// Tier 1 cleaners who were offered a shift and haven't replied. Each tier has
// its own schedule so Tier 1 can be chased on a different cadence to Tier 2/3.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { remindTier } from "../_shared/remindTier.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const reminded = await remindTier(serviceClient(), "tier_1");
  return json({ ok: true, reminded });
});

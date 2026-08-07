// remind-tier-3 — cron (admin-scheduled from /schedule). WhatsApp reminder to
// Tier 3 cleaners who were offered a shift and haven't replied. Each tier has
// its own schedule so Tier 3 can be chased on its own cadence.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { remindTier } from "../_shared/remindTier.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const reminded = await remindTier(serviceClient(), "tier_3");
  return json({ ok: true, reminded });
});

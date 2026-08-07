// remind-tier-2 — cron (admin-scheduled from /schedule). WhatsApp reminder to
// Tier 2 cleaners who were offered a shift and haven't replied. Each tier has
// its own schedule so Tier 2 can be chased on its own cadence.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { remindTier } from "../_shared/remindTier.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const reminded = await remindTier(serviceClient(), "tier_2");
  return json({ ok: true, reminded });
});

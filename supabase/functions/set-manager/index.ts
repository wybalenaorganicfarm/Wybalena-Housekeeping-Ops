// set-manager — app-facing (admin/super_admin/ops manager). (Re)nominates or
// clears the Cleaning Manager — the one cleaner auto-rostered onto every
// non-wipeover shift. All the atomic work — clear the old holder's future roster
// rows, move the is_team_leader flag, backfill the new holder onto upcoming shifts
// silently — happens inside the set_cleaning_manager / clear_cleaning_manager RPC
// (one transaction). This function is authz + audit only.
//
// Gated at isWriter (owner/ops), NOT canManageCleaners: re-nominating the manager
// is an ownership decision, so a Cleaning Manager (team_leader role) can't
// reassign the role away from themselves or to someone else.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { getCaller, isWriter } from "../_shared/authz.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  const sb = serviceClient();
  const caller = await getCaller(req, sb);
  if (!caller || !isWriter(caller.role)) return json({ error: "forbidden" }, 403);

  const { cleanerId, stepDownId } = await req.json().catch(() => ({}));

  // stepDownId -> step THAT holder down, leaving any other managers in place.
  // The role is multi-holder, so a step-down must never clear everyone.
  if (stepDownId) {
    const { data: cl } = await sb.from("cleaners").select("full_name, is_team_leader").eq("id", stepDownId).maybeSingle();
    if (!cl) return json({ error: "cleaner not found" }, 404);
    if (!cl.is_team_leader) return json({ error: "that cleaner is not a Cleaning Manager" }, 400);

    const { error } = await sb.rpc("clear_one_cleaning_manager", { p_cleaner_id: stepDownId });
    if (error) return json({ error: error.message }, 400);

    await writeAuditLog(sb, {
      event_type: "cleaner.manager_cleared",
      event_label: "Cleaning Manager Stepped Down",
      status: "success",
      summary: `${cl.full_name} is no longer a Cleaning Manager. Their upcoming roster rows were removed; any other managers are unaffected.`,
      detail: { cleaner_id: stepDownId, by: caller.userId },
      source: "set-manager",
      cleaner_id: stepDownId,
      triggered_by: "manual",
    });
    return json({ ok: true });
  }

  // cleanerId present -> nominate that cleaner; absent -> clear the role entirely.
  if (cleanerId) {
    const { data: cl } = await sb.from("cleaners").select("full_name, is_active").eq("id", cleanerId).maybeSingle();
    if (!cl) return json({ error: "cleaner not found" }, 404);
    if (!cl.is_active) return json({ error: "that cleaner is Inactive — set them Active before nominating" }, 400);

    const { error } = await sb.rpc("set_cleaning_manager", { p_cleaner_id: cleanerId });
    if (error) return json({ error: error.message }, 400);

    await writeAuditLog(sb, {
      event_type: "cleaner.manager_set",
      event_label: "Cleaning Manager Nominated",
      status: "success",
      summary: `${cl.full_name} is now a Cleaning Manager. They are rostered onto all upcoming shifts (silently) and new shifts going forward. Any existing managers keep the role.`,
      detail: { cleaner_id: cleanerId, by: caller.userId },
      source: "set-manager",
      cleaner_id: cleanerId,
      triggered_by: "manual",
    });
    return json({ ok: true });
  }

  // Clear (step-down, no replacement).
  const { error } = await sb.rpc("clear_cleaning_manager");
  if (error) return json({ error: error.message }, 400);
  await writeAuditLog(sb, {
    event_type: "cleaner.manager_cleared",
    event_label: "Cleaning Manager Cleared",
    status: "success",
    summary: "The Cleaning Manager role has been cleared. No cleaner is currently the manager; upcoming roster rows removed.",
    detail: { by: caller.userId },
    source: "set-manager",
    triggered_by: "manual",
  });
  return json({ ok: true });
});

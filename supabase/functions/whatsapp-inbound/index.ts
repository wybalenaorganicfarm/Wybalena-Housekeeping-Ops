// whatsapp-inbound — Whapi webhook (cleaner replies). REPLACES the old Make.com
// scenario (Spec §7.5). Register this function's URL in the Whapi dashboard as
// the inbound callback. verify_jwt is OFF (Whapi has no Supabase JWT) — instead
// we verify a shared secret.
//
// Behaviour: receive & verify -> idempotency on provider message id -> resolve
// cleaner (phone) + offer (offer_code) -> apply accept/decline/cancel -> reply.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { parseInbound } from "../_shared/adapters/whatsapp.ts";
import { acceptOffer, cancelOffer, declineOffer } from "../_shared/engine.ts";
import { sendMessage } from "../_shared/adapters/whatsapp.ts";
import { writeAuditLog } from "../_shared/auditLog.ts";

const SOURCE = "whatsapp-inbound";

function normPhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

// Resolve the shift behind an assignment, plus its accepted/required counts —
// used to write plain-English audit summaries for inbound replies.
async function shiftContext(sb: ReturnType<typeof serviceClient>, assignmentId: string) {
  const { data: a } = await sb
    .from("shift_assignments")
    .select("shift_id, shifts(shift_date, required_cleaners, status)")
    .eq("id", assignmentId)
    .maybeSingle();
  const sh = (a as Record<string, any>)?.shifts;
  const shiftId = (a as Record<string, any>)?.shift_id as string | undefined;
  let accepted = 0;
  if (shiftId) {
    const { count } = await sb
      .from("shift_assignments")
      .select("id", { count: "exact", head: true })
      .eq("shift_id", shiftId)
      .eq("status", "accepted");
    accepted = count ?? 0;
  }
  return {
    shiftId,
    shiftDate: sh?.shift_date as string | undefined,
    required: sh?.required_cleaners as number | undefined,
    status: sh?.status as string | undefined,
    accepted,
  };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  // 1. Verify it's genuinely from Whapi (shared secret via header or ?secret=).
  const expected = Deno.env.get("WHATSAPP_WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret") ??
    new URL(req.url).searchParams.get("secret");
  if (expected && provided !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => ({}));
  const sb = serviceClient();
  const replies = parseInbound(payload);
  const results: unknown[] = [];

  for (const r of replies) {
   try {
    if (!r.providerMessageId) continue;

    // Only respond to a genuine offer reply: a tapped quick-reply button, or an
    // explicit YES/NO/CANCEL keyword. Any other text is ignored silently so we
    // never spam people who are just messaging the number (Spec §7.5).
    if (r.action === "unknown" && !r.assignmentId) {
      results.push({ id: r.providerMessageId, skipped: "not an offer reply" });
      continue;
    }

    // 4. Idempotency: skip a re-delivered message id.
    const { error: dupErr } = await sb
      .from("processed_messages")
      .insert({ provider_message_id: r.providerMessageId });
    if (dupErr) { // primary-key conflict -> already processed
      results.push({ id: r.providerMessageId, skipped: "duplicate" });
      continue;
    }

    // 2. Resolve cleaner by phone.
    const phone = normPhone(r.fromPhone);
    const { data: cleaners } = await sb.from("cleaners").select("id, full_name, phone");
    const cleaner = (cleaners ?? []).find((c) => normPhone(c.phone) === phone);
    if (!cleaner) {
      results.push({ id: r.providerMessageId, skipped: "unknown number" });
      await writeAuditLog(sb, {
        event_type: "response.unknown",
        event_label: "WhatsApp Reply Received",
        status: "warning",
        summary: `Unrecognised WhatsApp reply from ${phone}. Could not match to an open offer.`,
        detail: { phone, text: r.rawText },
        source: SOURCE,
        triggered_by: "webhook",
      });
      continue;
    }

    // 2b. Resolve the offer this reply refers to.
    //     Button taps carry the assignment id in the payload — use it directly,
    //     but verify it belongs to this cleaner and is still actionable.
    let assignmentId: string | null = null;
    if (r.assignmentId) {
      const { data: own } = await sb
        .from("shift_assignments")
        .select("id")
        .eq("id", r.assignmentId)
        .eq("cleaner_id", cleaner.id)
        .in("status", ["offered", "accepted"])
        .maybeSingle();
      assignmentId = own?.id ?? null;
    } else if (r.offerCode) {
      const { data: byCode } = await sb
        .from("shift_assignments")
        .select("id, status")
        .eq("cleaner_id", cleaner.id)
        .eq("offer_code", r.offerCode)
        .in("status", ["offered", "accepted"])
        .order("offered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      assignmentId = byCode?.id ?? null;
    } else {
      const { data: open } = await sb
        .from("shift_assignments")
        .select("id")
        .eq("cleaner_id", cleaner.id)
        .in("status", ["offered", "accepted"]);
      if ((open ?? []).length === 1) assignmentId = open![0].id;
      else if ((open ?? []).length > 1) {
        await sendMessage(cleaner.phone, "You have multiple offers — please include the code, e.g. YES 4823.");
        results.push({ id: r.providerMessageId, skipped: "ambiguous, nudged" });
        continue;
      }
    }

    if (!assignmentId) {
      await sendMessage(cleaner.phone, "We couldn't match that to an open offer. Reply YES/NO/CANCEL with the code.");
      results.push({ id: r.providerMessageId, skipped: "no matching offer" });
      await writeAuditLog(sb, {
        event_type: "response.unknown",
        event_label: "WhatsApp Reply Received",
        status: "warning",
        summary: `Unrecognised WhatsApp reply from ${cleaner.full_name}. Could not match to an open offer.`,
        detail: { phone, text: r.rawText },
        source: SOURCE,
        cleaner_id: cleaner.id,
        triggered_by: "webhook",
      });
      continue;
    }

    // Snapshot the shift context BEFORE acting (date stays valid even if the row
    // changes), for plain-English log summaries.
    const ctx = await shiftContext(sb, assignmentId);
    const dateLabel = ctx.shiftDate ?? "—";

    // 3. Apply the action.
    switch (r.action) {
      case "accept": {
        const res = await acceptOffer(sb, assignmentId);
        if (res === "accepted") await sendMessage(cleaner.phone, "You're confirmed — thank you! ✅");
        else if (res === "already_full") await sendMessage(cleaner.phone, "Sorry, that shift just filled up.");
        else await sendMessage(cleaner.phone, "That offer is no longer open.");
        results.push({ id: r.providerMessageId, action: "accept", result: res });

        if (res === "accepted") {
          const after = await shiftContext(sb, assignmentId);
          await writeAuditLog(sb, {
            event_type: "response.accepted",
            event_label: "WhatsApp Reply Received",
            status: "success",
            summary: `${cleaner.full_name} accepted the shift on ${dateLabel}. Assigned count: ${after.accepted}/${after.required ?? "?"}.`,
            detail: { assignment_id: assignmentId, accepted: after.accepted, required: after.required },
            source: SOURCE,
            shift_id: ctx.shiftId,
            cleaner_id: cleaner.id,
            triggered_by: "webhook",
          });
          // Shift just filled up as a result of this acceptance.
          if (after.status === "fully_staffed") {
            await writeAuditLog(sb, {
              event_type: "response.shift_full",
              event_label: "WhatsApp Reply Received",
              status: "success",
              summary: `Shift on ${dateLabel} is now fully staffed. Remaining offered cleaners notified.`,
              detail: { shift_id: ctx.shiftId, accepted: after.accepted, required: after.required },
              source: SOURCE,
              shift_id: ctx.shiftId,
              triggered_by: "webhook",
            });
          }
        } else if (res === "already_full") {
          await writeAuditLog(sb, {
            event_type: "response.shift_full",
            event_label: "WhatsApp Reply Received",
            status: "success",
            summary: `Shift on ${dateLabel} is now fully staffed. Remaining offered cleaners notified.`,
            detail: { shift_id: ctx.shiftId },
            source: SOURCE,
            shift_id: ctx.shiftId,
            cleaner_id: cleaner.id,
            triggered_by: "webhook",
          });
        }
        break;
      }
      case "decline": {
        await declineOffer(sb, assignmentId);
        await sendMessage(cleaner.phone, "Noted — thanks for letting us know.");
        results.push({ id: r.providerMessageId, action: "decline" });
        await writeAuditLog(sb, {
          event_type: "response.declined",
          event_label: "WhatsApp Reply Received",
          status: "success",
          summary: `${cleaner.full_name} declined the shift on ${dateLabel}. Removed from offer list.`,
          detail: { assignment_id: assignmentId },
          source: SOURCE,
          shift_id: ctx.shiftId,
          cleaner_id: cleaner.id,
          triggered_by: "webhook",
        });
        break;
      }
      case "cancel": {
        await cancelOffer(sb, assignmentId);
        await sendMessage(cleaner.phone, "Your spot has been cancelled and re-offered. Thanks for the heads up.");
        results.push({ id: r.providerMessageId, action: "cancel" });
        await writeAuditLog(sb, {
          event_type: "response.cancelled",
          event_label: "WhatsApp Reply Received",
          status: "warning",
          summary: `${cleaner.full_name} cancelled their confirmed spot on ${dateLabel}. Re-assignment triggered.`,
          detail: { assignment_id: assignmentId },
          source: SOURCE,
          shift_id: ctx.shiftId,
          cleaner_id: cleaner.id,
          triggered_by: "webhook",
        });
        break;
      }
      default: {
        await sendMessage(cleaner.phone, "Please reply YES, NO, or CANCEL followed by your offer code.");
        results.push({ id: r.providerMessageId, action: "unknown, nudged" });
      }
    }
   } catch (e) {
      results.push({ id: r.providerMessageId, error: String(e) });
      await writeAuditLog(sb, {
        event_type: "response.inbound",
        event_label: "WhatsApp Reply Received",
        status: "failed",
        summary: `WhatsApp inbound webhook failed to process. Error: ${String(e)}.`,
        error_message: String(e),
        detail: { message_id: r.providerMessageId },
        source: SOURCE,
        triggered_by: "webhook",
      });
   }
  }

  // 1b. Return 200 fast so Whapi doesn't retry on slow downstream work.
  return json({ ok: true, processed: results });
});

// whatsapp-inbound — Whapi webhook (cleaner replies). REPLACES the old Make.com
// scenario (Spec §7.5). Register this function's URL in the Whapi dashboard as
// the inbound callback. verify_jwt is OFF (Whapi has no Supabase JWT) — instead
// we verify a shared secret.
//
// Behaviour: receive & verify -> idempotency on provider message id -> resolve
// cleaner (phone) + offer (offer_code) -> apply accept/decline/cancel -> reply.
import { serviceClient } from "../_shared/client.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { parseInbound, sendDeclineConfirm, sendMessage } from "../_shared/adapters/whatsapp.ts";
import { acceptOffer, cancelOffer, declineOffer } from "../_shared/engine.ts";
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
    .select("shift_id, shifts(shift_date, start_time, required_cleaners, status)")
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
    shiftTime: (sh?.start_time as string | undefined)?.slice(0, 5),
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
  // Log the raw inbound shape so button-reply payload variants are diagnosable in
  // the function logs if matching ever fails again.
  console.log("[whatsapp-inbound] payload", JSON.stringify(payload));
  const sb = serviceClient();
  const replies = parseInbound(payload);
  const results: unknown[] = [];

  for (const r of replies) {
   try {
    if (!r.providerMessageId) continue;

    // 4. Idempotency: skip a re-delivered message id.
    const { error: dupErr } = await sb
      .from("processed_messages")
      .insert({ provider_message_id: r.providerMessageId });
    if (dupErr) { // primary-key conflict -> already processed
      results.push({ id: r.providerMessageId, skipped: "duplicate" });
      continue;
    }

    // 2. Resolve cleaner by phone. THE HARD GATE: the number must exist in the
    //    cleaners table. This is a shared WhatsApp line that also receives normal
    //    personal chats — anything from a non-cleaner is ignored SILENTLY. We do
    //    not reply and do not log a warning (that just clutters System Logs with
    //    every random message the line receives).
    const phone = normPhone(r.fromPhone);
    const { data: cleaners } = await sb.from("cleaners").select("id, full_name, phone");
    const cleaner = (cleaners ?? []).find((c) => normPhone(c.phone) === phone);
    if (!cleaner) {
      console.log(`[whatsapp-inbound] ignoring message from non-cleaner ${phone}`);
      results.push({ id: r.providerMessageId, skipped: "not a cleaner" });
      continue;
    }

    // 2b. Resolve the offer this reply refers to, trying each signal in turn and
    //     FALLING THROUGH if one doesn't resolve. We only verify the row belongs to
    //     this cleaner (no status filter) so a declined offer can still be
    //     re-accepted; per-action logic below decides what's valid.
    let assignmentId: string | null = null;
    const ownedById = async (col: string, val: string) => {
      const { data } = await sb
        .from("shift_assignments")
        .select("id")
        .eq(col, val)
        .eq("cleaner_id", cleaner.id)
        .order("offered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    };

    // (a) button-encoded assignment id.
    if (r.assignmentId) assignmentId = await ownedById("id", r.assignmentId);
    // (b) the message this reply quotes → the stored offer message id, or the
    //     decline-confirmation message id (reliable even with several open offers).
    if (!assignmentId && r.quotedMessageId) assignmentId = await ownedById("offer_message_id", r.quotedMessageId);
    if (!assignmentId && r.quotedMessageId) assignmentId = await ownedById("confirm_message_id", r.quotedMessageId);
    // (c) explicit offer code in the text.
    if (!assignmentId && r.offerCode) assignmentId = await ownedById("offer_code", r.offerCode);
    // (d) last resort: the cleaner's single open offer.
    if (!assignmentId) {
      const { data: open } = await sb
        .from("shift_assignments")
        .select("id")
        .eq("cleaner_id", cleaner.id)
        .in("status", ["offered", "accepted"])
        .order("offered_at", { ascending: false });
      if ((open ?? []).length === 1) assignmentId = open![0].id;
      else if ((open ?? []).length > 1) {
        await sendMessage(cleaner.phone, "Please scroll to the specific shift and tap *Accept*, *Decline* or *Cancel* on that message — or reply with that shift's code, e.g. *ACCEPT 4823*.");
        results.push({ id: r.providerMessageId, skipped: "ambiguous, nudged" });
        continue;
      }
    }

    if (!assignmentId) {
      // A real command (accept/decline/cancel) with no offer to apply it to →
      // tell them. Free-form chatter from a cleaner with no open offer → stay
      // silent so we don't reply to every "thanks"/"ok".
      if (r.action !== "unknown") {
        await sendMessage(cleaner.phone, "Sorry, we couldn't find an open shift offer to apply that to. If you were offered a shift, please tap Accept, Decline or Cancel on the offer message.");
        await writeAuditLog(sb, {
          event_type: "response.unknown",
          event_label: "WhatsApp Reply Received",
          status: "warning",
          summary: `Unrecognised WhatsApp reply from ${cleaner.full_name}. Could not match to an open offer.`,
          detail: { phone, text: r.rawText, action: r.action, assignment_id: r.assignmentId, offer_code: r.offerCode },
          source: SOURCE,
          cleaner_id: cleaner.id,
          triggered_by: "webhook",
        });
      }
      results.push({ id: r.providerMessageId, skipped: r.action === "unknown" ? "ignored chatter" : "no matching offer" });
      continue;
    }

    // Snapshot the shift context + this assignment's current state BEFORE acting.
    const ctx = await shiftContext(sb, assignmentId);
    const dateLabel = ctx.shiftDate ?? "—";
    const when = `${dateLabel}${ctx.shiftTime ? ` at ${ctx.shiftTime}` : ""}`;
    const { data: assn } = await sb
      .from("shift_assignments").select("status, offer_code").eq("id", assignmentId).maybeSingle();
    const code = assn?.offer_code ?? "";
    const alreadyAccepted = assn?.status === "accepted";
    const logResponse = (event: string, status: "success" | "warning", summary: string) =>
      writeAuditLog(sb, {
        event_type: event, event_label: "WhatsApp Reply Received", status, summary,
        detail: { assignment_id: assignmentId }, source: SOURCE,
        shift_id: ctx.shiftId, cleaner_id: cleaner.id, triggered_by: "webhook",
      });

    // 3. Apply the action.
    switch (r.action) {
      case "accept": {
        if (alreadyAccepted) {
          await sendMessage(cleaner.phone, `You're already confirmed for this shift ✅. If you can't make it, tap *Cancel* on the shift offer, or reply *CANCEL ${code}*.`);
          results.push({ id: r.providerMessageId, action: "accept", result: "already_accepted" });
          break;
        }
        const res = await acceptOffer(sb, assignmentId);
        if (res === "accepted") {
          await sendMessage(cleaner.phone, `You're confirmed — thank you! ✅\nYou're on the cleaning team for ${when}.\nIf you later can't make it, tap *Cancel* on the shift offer, or reply *CANCEL ${code}*.`);
          const after = await shiftContext(sb, assignmentId);
          await logResponse("response.accepted", "success", `${cleaner.full_name} accepted the shift on ${dateLabel}. Assigned count: ${after.accepted}/${after.required ?? "?"}.`);
          if (after.status === "fully_staffed") {
            await logResponse("response.shift_full", "success", `Shift on ${dateLabel} is now fully staffed. Remaining offered cleaners notified.`);
          }
        } else if (res === "already_full") {
          await sendMessage(cleaner.phone, "Sorry, this shift just filled up and is now fully staffed. Thanks for responding!");
          await logResponse("response.shift_full", "success", `Shift on ${dateLabel} is now fully staffed. ${cleaner.full_name}'s acceptance came in after it filled.`);
        } else {
          await sendMessage(cleaner.phone, "Sorry, that shift offer is no longer open.");
        }
        results.push({ id: r.providerMessageId, action: "accept", result: res });
        break;
      }
      case "decline": {
        // Can't decline after accepting — give it up via Cancel instead.
        if (alreadyAccepted) {
          await sendMessage(cleaner.phone, `You've already accepted this shift. If you can't make it, please tap the *Cancel* button on that shift offer, or reply *CANCEL ${code}*.`);
          results.push({ id: r.providerMessageId, action: "decline", result: "blocked_already_accepted" });
          break;
        }
        // Already declined — no confirmation loop, just say so.
        if (assn?.status === "declined") {
          await sendMessage(cleaner.phone, "You've already declined this shift. No further action needed.");
          results.push({ id: r.providerMessageId, action: "decline", result: "already_declined" });
          break;
        }
        // Re-verify before declining. Store the prompt's id separately so a later
        // reply to the original offer still resolves.
        const res = await sendDeclineConfirm(cleaner.phone, dateLabel, assignmentId);
        if (res?.providerMessageId) {
          await sb.from("shift_assignments").update({ confirm_message_id: res.providerMessageId }).eq("id", assignmentId);
        }
        results.push({ id: r.providerMessageId, action: "decline", result: "confirm_requested" });
        break;
      }
      case "decline_confirm": { // tapped "Yes, decline"
        await declineOffer(sb, assignmentId);
        await sendMessage(cleaner.phone, `No problem — you've declined the shift on ${dateLabel}. Thanks for letting us know.`);
        await logResponse("response.declined", "success", `${cleaner.full_name} declined the shift on ${dateLabel}. Removed from offer list.`);
        results.push({ id: r.providerMessageId, action: "decline_confirm" });
        break;
      }
      case "decline_cancel": { // tapped "No, go back"
        await sendMessage(cleaner.phone, "Great — please tap *Accept* to take the shift, or *Decline* if you can't make it.");
        results.push({ id: r.providerMessageId, action: "decline_cancel" });
        break;
      }
      case "cancel": {
        // Nothing to cancel if they already declined or cancelled this shift.
        if (assn?.status === "declined") {
          await sendMessage(cleaner.phone, "You've already declined this shift, so there's nothing to cancel.");
          results.push({ id: r.providerMessageId, action: "cancel", result: "already_declined" });
          break;
        }
        if (assn?.status === "cancelled" || assn?.status === "no_response") {
          await sendMessage(cleaner.phone, "You're not currently on this shift, so there's nothing to cancel.");
          results.push({ id: r.providerMessageId, action: "cancel", result: "not_active" });
          break;
        }
        await cancelOffer(sb, assignmentId);
        await sendMessage(cleaner.phone, "Your spot has been cancelled and the shift has been re-offered. Thanks for the heads up.");
        // Raise an alert so the admin sees it on the Dashboard + Alerts and can
        // step in / assign manually. Dedupe one open alert per shift.
        if (ctx.shiftId) {
          const { data: dup } = await sb.from("alerts").select("id")
            .eq("alert_type", "cleaner_cancelled").eq("shift_id", ctx.shiftId).eq("status", "open").maybeSingle();
          if (!dup) {
            await sb.from("alerts").insert({
              alert_type: "cleaner_cancelled",
              shift_id: ctx.shiftId,
              title: "Cleaner cancelled",
              body: `${cleaner.full_name} cancelled their spot on ${dateLabel}. Re-assignment is in progress — you can also assign a cleaner manually.`,
            });
          }
        }
        await logResponse("response.cancelled", "warning", `${cleaner.full_name} cancelled their spot on ${dateLabel}. Re-assignment triggered; admin alerted.`);
        results.push({ id: r.providerMessageId, action: "cancel" });
        break;
      }
      default: {
        await sendMessage(cleaner.phone, `Sorry, I can only understand the buttons. Please tap *Accept*, *Decline* or *Cancel* on the shift offer — or reply *ACCEPT ${code}*, *DECLINE ${code}* or *CANCEL ${code}*.`);
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

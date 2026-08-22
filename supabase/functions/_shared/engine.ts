// Assignment engine — the shared heart of the system.
// Reused by the cron jobs (offer-tier-1, escalate-tier-2/3, remind-nonresponders)
// and the whatsapp-inbound webhook. All writes use the service-role client.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendButtons, sendMessage } from "./adapters/whatsapp.ts";
import { btnTitle, fillVars, loadTemplate, renderTemplate } from "./templates.ts";
import { prettyDate, prettyDateTime, prettyTime } from "./datetime.ts";
import { writeAuditLog } from "./auditLog.ts";

export type Tier = "tier_1" | "tier_2" | "tier_3";

// Which automation chain owns a shift. Decided at the first delivered offer and
// never changed — see supabase/migrations/20260819120000_staffing_track.sql.
export type StaffingTrack = "weekly" | "catchup";

// Tier order, for "has this shift escalated PAST that offer?" comparisons.
const TIER_RANK: Record<Tier, number> = { tier_1: 1, tier_2: 2, tier_3: 3 };

// Resource formula (Spec §2): standard = Zara + 5 = 6; deep/full venue = Zara + 6 = 7.
// mid_retreat & other default to the standard size. required_cleaners is stored
// on the shift so manual overrides persist — this is only used at creation time.
export function requiredForType(shiftType: string): number {
  return shiftType === "deep_full_venue" ? 7 : 6;
}

interface ShiftRow {
  id: string;
  status: string;
  required_cleaners: number;
  current_tier: Tier | null;
  shift_type: string;
  shift_date: string;
  start_time: string;
  staffing_track: StaffingTrack | null;
}

async function loadShift(sb: SupabaseClient, shiftId: string): Promise<ShiftRow | null> {
  const { data } = await sb.from("shifts").select("*").eq("id", shiftId).maybeSingle();
  return data as ShiftRow | null;
}

async function acceptedCount(sb: SupabaseClient, shiftId: string): Promise<number> {
  const { count } = await sb
    .from("shift_assignments")
    .select("id", { count: "exact", head: true })
    .eq("shift_id", shiftId)
    .eq("status", "accepted");
  return count ?? 0;
}

function gen4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Send the interactive Accept/Decline offer to one cleaner. Button payloads carry
// the assignment id ("accept:<id>") so the inbound webhook maps the tap back to
// this exact row. Only Accept/Decline are offered up front — the Cancel button
// appears later, on the "Shift Accepted" confirmation, for cleaners who accepted.
async function sendOfferMessage(
  sb: SupabaseClient,
  phone: string,
  shift: ShiftRow,
  assignmentId: string | undefined,
  offerCode: string | null | undefined,
) {
  // Cleaners read these — spell the day out and use am/pm, never raw ISO.
  const date = prettyDate(shift.shift_date);
  const time = prettyTime(shift.start_time);
  const t = await loadTemplate(sb, "shift_offer");
  // The fallback text is what a cleaner gets when the buttons could not be sent,
  // so it must never tell them to tap one. It asks for a keyword reply carrying
  // the offer code, which is how whatsapp-inbound pins a typed reply to this
  // exact offer — without it a cleaner holding more than one open offer is
  // deliberately ignored, and their reply goes nowhere.
  const codeSuffix = offerCode ? ` ${offerCode}` : "";
  const vars = { shift_date: date, start_time: time, offer_code: offerCode ?? "" };
  const body = t?.body
    ? fillVars(t.body, vars)
    : `*SHIFT DETAILS*\n\n📅 Date: ${date}\n⏰ Time: ${time}\n\n` +
      `Tap *Accept* to take this shift, or *Decline* to pass.`;
  return await sendButtons(
    phone,
    body,
    [
      { id: `accept:${assignmentId}`, title: btnTitle(t, "accept", "✅ Accept") },
      { id: `decline:${assignmentId}`, title: btnTitle(t, "decline", "❌ Decline") },
    ],
    {
      header: t?.header ?? "🧹 New Cleaning Shift Available",
      footer: t?.footer ?? "Wybalena Organic Farm",
      fallbackText: t?.fallback
        ? fillVars(t.fallback, vars)
        : `New cleaning shift on ${date} at ${time}.\n\n` +
          `The Accept/Decline buttons didn't come through this time. ` +
          `Please reply ACCEPT${codeSuffix} to take this shift, or DECLINE${codeSuffix} to pass.`,
    },
  );
}

// Send the offer to one cleaner and record the outbound message id on the
// assignment, so an inbound tap/reply can be matched back to this exact offer.
// Returns true only when the offer actually reached the cleaner (or was stubbed
// in dev). A false result means the WhatsApp channel rejected the send — the
// caller rolls back the assignment so the cleaner can be re-offered next run.
async function sendAndRecordOffer(
  sb: SupabaseClient,
  phone: string | null,
  shift: ShiftRow,
  assignmentId: string | undefined,
  cleaner: { id: string; full_name: string; offer_code?: string | null },
): Promise<boolean> {
  if (!phone || !assignmentId) return false;
  const res = await sendOfferMessage(sb, phone, shift, assignmentId, cleaner.offer_code);
  if (!res.ok) return false;
  if (res.providerMessageId) {
    await sb.from("shift_assignments")
      .update({ offer_message_id: res.providerMessageId })
      .eq("id", assignmentId);
  }
  // The offer landed, but as plain text — WhatsApp refused the buttons on every
  // attempt. Recorded here, at the one point every send path passes through, so
  // a downgraded offer is visible on the Audit page instead of reading as a
  // clean success (which is exactly how the 24 September offer was logged).
  if (res.degraded) {
    const code = cleaner.offer_code;
    await writeAuditLog(sb, {
      event_type: "offer.sent_without_buttons",
      event_label: "Offer Sent Without Buttons",
      status: "warning",
      summary: `Offer for the shift on ${prettyDate(shift.shift_date)} reached ${cleaner.full_name} as a plain text message — WhatsApp refused the Accept/Decline buttons on every attempt. ` +
        (code
          ? `They can still reply ACCEPT ${code} or DECLINE ${code}.`
          : `They can still reply ACCEPT or DECLINE.`),
      detail: { shift_id: shift.id, assignment_id: assignmentId, offer_code: code, provider_status: res.status },
      source: "engine",
      shift_id: shift.id,
      cleaner_id: cleaner.id,
      triggered_by: "system",
    });
  }
  return true;
}

// Manually offer a shift to one specific cleaner (admin override). Unlike the old
// behaviour this does NOT auto-accept — it creates an `offered` assignment and
// sends the Accept/Decline buttons, so the cleaner must reply. Re-offers reset a
// previously declined/cancelled row via the (shift_id, cleaner_id) upsert.
export async function offerToCleaner(
  sb: SupabaseClient,
  shiftId: string,
  cleanerId: string,
): Promise<"offered" | "error" | "send_failed" | "inactive"> {
  const shift = await loadShift(sb, shiftId);
  if (!shift || shift.status === "cancelled") return "error";

  const { data: cleaner } = await sb
    .from("cleaners").select("id, full_name, phone, tier, is_team_leader, is_active").eq("id", cleanerId).maybeSingle();
  if (!cleaner) return "error";
  // The team lead is auto-assigned to every shift and is never offered/re-offered.
  if (cleaner.is_team_leader) return "error";
  // Never send an offer to an Inactive cleaner — the UI already hides them,
  // this is the server-side guard for manual assign / any direct call.
  if (!cleaner.is_active) return "inactive";

  const code = gen4();
  const { data: row } = await sb
    .from("shift_assignments")
    .upsert({
      shift_id: shiftId,
      cleaner_id: cleanerId,
      tier_at_offer: cleaner.tier,
      status: "offered",
      offer_code: code,
      is_manual_override: true,
      responded_at: null,
    }, { onConflict: "shift_id,cleaner_id" })
    .select("id, offer_code")
    .maybeSingle();

  // If the WhatsApp channel rejects the send, roll the offer back so we don't
  // report a phantom "offered" the cleaner never received, and don't flip the
  // shift into staffing off the back of a message that never went out.
  const ok = await sendAndRecordOffer(sb, cleaner.phone, shift, row?.id, {
    id: cleaner.id,
    full_name: cleaner.full_name,
    offer_code: row?.offer_code ?? code,
  });
  if (!ok) {
    if (row?.id) await sb.from("shift_assignments").delete().eq("id", row.id);
    return "send_failed";
  }

  // Reflect that the shift is actively being staffed (only once delivered).
  if (shift.status === "pending_confirmation" || shift.status === "confirmed") {
    await sb.from("shifts")
      .update({
        status: "staffing",
        current_tier: shift.current_tier ?? cleaner.tier,
        // An admin has taken this shift in hand, so put it on the weekly chain
        // rather than leaving it untracked for staffing-catchup to adopt.
        staffing_track: shift.staffing_track ?? "weekly",
      })
      .eq("id", shiftId);
  }
  return "offered";
}

// Result of an offerTier run — rich enough for plain-English audit logging.
//   count        : offers actually DELIVERED this run (send succeeded)
//   offered      : the cleaners successfully offered (id + name) for the summary
//   shiftDate    : the shift's date (for the log summary)
//   openSpots    : spots still unfilled at the moment of the run
//   fullyStaffed : true when the shift was already full (no offers needed)
//   failed       : offers that could NOT be delivered (WhatsApp channel error)
//   failedNames  : the cleaners we couldn't reach — for the failure alert
export interface OfferResult {
  count: number;
  offered: { id: string; full_name: string }[];
  shiftDate: string;
  openSpots: number;
  fullyStaffed: boolean;
  failed: number;
  failedNames: string[];
}

function emptyOffer(shiftDate: string, openSpots: number, fullyStaffed: boolean): OfferResult {
  return { count: 0, offered: [], shiftDate, openSpots, fullyStaffed, failed: 0, failedNames: [] };
}

// Send every pending offer, roll back the ones the WhatsApp channel rejected, and
// report who was delivered vs who couldn't be reached. Shared by offerTier and
// reofferToUnaccepted. `inserted` maps cleaner_id -> that cleaner's offer row.
async function deliverOffers(
  sb: SupabaseClient,
  shift: ShiftRow,
  candidates: { id: string; full_name: string; phone: string | null }[],
  inserted: { id: string; cleaner_id: string; offer_code?: string | null }[],
  // Assignment ids that already existed and were re-opened rather than created.
  reopenedIds?: Set<string>,
): Promise<{ offered: { id: string; full_name: string }[]; failedIds: string[]; failedNames: string[] }> {
  const byId = new Map(inserted.map((r) => [r.cleaner_id, r]));
  const offered: { id: string; full_name: string }[] = [];
  const failedIds: string[] = [];
  const failedNames: string[] = [];
  for (const c of candidates) {
    const row = byId.get(c.id);
    const ok = await sendAndRecordOffer(sb, c.phone, shift, row?.id, {
      id: c.id,
      full_name: c.full_name,
      offer_code: row?.offer_code,
    });
    if (ok) offered.push({ id: c.id, full_name: c.full_name });
    else {
      if (row?.id) failedIds.push(row.id);
      failedNames.push(c.full_name);
    }
  }
  // Undeliverable offers must not linger as "offered" — they'd block the cleaner
  // from being re-offered next run and hold the shift in a false "staffing" state.
  // Rows this run CREATED are deleted; rows it merely re-opened are put back to
  // no_response, because deleting them would destroy the cleaner's real history
  // on the shift (their earlier decline, their earlier offer).
  if (failedIds.length) {
    const created = failedIds.filter((id) => !reopenedIds?.has(id));
    const reopened = failedIds.filter((id) => reopenedIds?.has(id));
    if (created.length) await sb.from("shift_assignments").delete().in("id", created);
    if (reopened.length) {
      await sb.from("shift_assignments").update({ status: "no_response" }).in("id", reopened);
    }
  }
  return { offered, failedIds, failedNames };
}

// Close every offer still sitting `offered` at a tier this shift has now
// escalated PAST. The cleaner didn't answer and the shift has moved on, so the
// offer is dead — leaving it open queued it for a non-responder reminder that
// would go out days or weeks later, which is exactly what produced the burst of
// duplicate reminders on 17 August.
//
// Two guards keep this to offers that are genuinely finished with:
//   • strictly earlier tiers — a cancellation re-offer (reofferToUnaccepted)
//     deliberately opens LATER tiers while the shift sits at an earlier one;
//   • already reminded — the offer went through its full chase and got no
//     answer. A cancellation re-offer made minutes ago has not been reminded
//     yet, so escalating the shift can't silently retire it.
// A late "Accept" still works either way: acceptOffer reads the row by id and
// doesn't require it to still be `offered`.
async function closeSupersededOffers(sb: SupabaseClient, shiftId: string, tier: Tier): Promise<void> {
  const passed = (Object.keys(TIER_RANK) as Tier[]).filter((t) => TIER_RANK[t] < TIER_RANK[tier]);
  if (passed.length === 0) return;
  await sb
    .from("shift_assignments")
    .update({ status: "no_response" })
    .eq("shift_id", shiftId)
    .eq("status", "offered")
    .in("tier_at_offer", passed)
    .not("reminder_sent_at", "is", null);
}

// Offer a shift to up to `openSpots` available cleaners in the given tier.
// Returns the offered cleaners. Sets the shift to staffing/current_tier.
//
// `track` is passed ONLY by the two jobs that make a shift's FIRST offer —
// offer-tier-1 ("weekly") and staffing-catchup's adoption branch ("catchup").
// It is stamped on the shift only if the shift has no track yet, so escalations
// (which never pass it) can't move a shift between chains.
export async function offerTier(
  sb: SupabaseClient,
  shiftId: string,
  tier: Tier,
  track?: StaffingTrack,
): Promise<OfferResult> {
  const shift = await loadShift(sb, shiftId);
  if (!shift || shift.status === "cancelled" || shift.status === "fully_staffed") {
    return emptyOffer(shift?.shift_date ?? "", 0, shift?.status === "fully_staffed");
  }

  const accepted = await acceptedCount(sb, shiftId);
  const openSpots = shift.required_cleaners - accepted;
  if (openSpots <= 0) {
    await markFullyStaffed(sb, shiftId);
    return emptyOffer(shift.shift_date, 0, true);
  }

  // Candidates: active, in tier, not already offered/assigned to this shift.
  const { data: existing } = await sb
    .from("shift_assignments")
    .select("cleaner_id")
    .eq("shift_id", shiftId);
  const taken = new Set((existing ?? []).map((r) => r.cleaner_id));

  const { data: pool } = await sb
    .from("cleaners")
    .select("id, full_name, phone")
    .eq("is_active", true)
    .eq("is_team_leader", false)
    .eq("tier", tier)
    .order("full_name");

  const candidates = (pool ?? []).filter((c) => !taken.has(c.id)).slice(0, openSpots);
  if (candidates.length === 0) {
    return emptyOffer(shift.shift_date, openSpots, false);
  }

  const rows = candidates.map((c) => ({
    shift_id: shiftId,
    cleaner_id: c.id,
    tier_at_offer: tier,
    status: "offered",
    offer_code: gen4(),
  }));
  const { data: inserted } = await sb
    .from("shift_assignments")
    .insert(rows)
    // offer_code comes back so the plain-text fallback can quote it if the
    // buttons don't send — it's the only way a typed reply resolves to this offer.
    .select("id, cleaner_id, offer_code");

  // Outbound offers: interactive Accept/Decline buttons whose payload carries the
  // assignment id, so the inbound webhook maps the tap straight to this row.
  // Undeliverable offers are rolled back inside deliverOffers.
  const { offered, failedNames } = await deliverOffers(sb, shift, candidates, inserted ?? []);

  // Only flag the shift as being staffed once at least one offer actually landed;
  // if every send failed the shift stays put so the next run retries cleanly.
  if (offered.length > 0) {
    const patch: Record<string, unknown> = { status: "staffing", current_tier: tier };
    // First delivered offer decides the chain; after that the track is fixed.
    if (track && !shift.staffing_track) patch.staffing_track = track;
    await sb.from("shifts").update(patch).eq("id", shiftId);
    // The shift has moved on — retire any unanswered offer at a tier it passed.
    await closeSupersededOffers(sb, shiftId, tier);
  }
  return {
    count: offered.length,
    offered,
    shiftDate: shift.shift_date,
    openSpots,
    fullyStaffed: false,
    failed: failedNames.length,
    failedNames,
  };
}

// The tier chain, read from the roster instead of hard-coded. `.order("tier")`
// sorts by the cleaner_tier enum's declaration order, so adding a tier_4 to the
// enum and putting a cleaner in it extends the chain with no code change. A tier
// with nobody offerable in it simply never appears.
export async function tierChain(sb: SupabaseClient): Promise<Tier[]> {
  const { data } = await sb
    .from("cleaners")
    .select("tier")
    .eq("is_active", true)
    .eq("is_team_leader", false)
    .order("tier");
  const chain: Tier[] = [];
  for (const r of data ?? []) {
    const t = r.tier as Tier;
    if (t && !chain.includes(t)) chain.push(t);
  }
  return chain;
}

// The next tier after `after` with at least one cleaner free to take THIS shift.
// Walks straight past a tier that is empty, or whose cleaners are all already on
// the shift: an empty middle tier must not stall the chain, and nothing here
// assumes there are exactly three tiers.
//
// `after` = null starts at the top. A null RESULT means the chain is exhausted —
// every tier has been through and there is nobody new left to ask.
export async function nextOfferableTier(
  sb: SupabaseClient,
  shiftId: string,
  after: Tier | null,
): Promise<Tier | null> {
  const chain = await tierChain(sb);
  const from = after ? chain.indexOf(after) + 1 : 0;
  if (after && from <= 0) return null;  // the shift's tier is no longer in the chain

  const { data: rows } = await sb
    .from("shift_assignments")
    .select("cleaner_id")
    .eq("shift_id", shiftId);
  const taken = new Set((rows ?? []).map((r) => r.cleaner_id));

  for (let i = from; i < chain.length; i++) {
    const { data: pool } = await sb
      .from("cleaners")
      .select("id")
      .eq("is_active", true)
      .eq("is_team_leader", false)
      .eq("tier", chain[i]);
    if ((pool ?? []).some((c) => !taken.has(c.id))) return chain[i];
  }
  return null;
}

// Last-resort re-offer after a cancellation, once the tier chain is exhausted.
//
// Unlike offerTier this ignores tiers entirely and re-asks EVERY offerable
// cleaner who has not accepted this shift — the ones who declined, the ones who
// never replied, and the one whose cancellation triggered it. By the time the
// chain is spent everyone already has a row on the shift, so an
// only-people-never-asked rule would find nobody and the fallback would be a
// no-op. A decline three weeks ago is not a decline today; asking again is the
// entire point of this step.
//
// shift_assignments is UNIQUE (shift_id, cleaner_id), so an existing row is
// RE-OPENED in place — fresh offer code, reminder stamp cleared so the reminder
// chain can chase it again — rather than duplicated.
export async function reofferToUnaccepted(
  sb: SupabaseClient,
  shiftId: string,
): Promise<OfferResult> {
  const shift = await loadShift(sb, shiftId);
  if (!shift || shift.status === "cancelled" || shift.status === "fully_staffed") {
    return emptyOffer(shift?.shift_date ?? "", 0, shift?.status === "fully_staffed");
  }

  const accepted = await acceptedCount(sb, shiftId);
  const openSpots = shift.required_cleaners - accepted;
  if (openSpots <= 0) {
    await markFullyStaffed(sb, shiftId);
    return emptyOffer(shift.shift_date, 0, true);
  }

  // Candidates: every active cleaner not already offered/assigned to this shift,
  // regardless of tier. No slice — everyone available gets the offer.
  const { data: existing } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id, status")
    .eq("shift_id", shiftId);
  const rows = existing ?? [];
  const onShift = new Set(rows.filter((r) => r.status === "accepted").map((r) => r.cleaner_id));
  const rowByCleaner = new Map(rows.map((r) => [r.cleaner_id, r]));

  const { data: pool } = await sb
    .from("cleaners")
    .select("id, full_name, phone, tier")
    .eq("is_active", true)
    .eq("is_team_leader", false)
    .order("tier")
    .order("full_name");

  // Everyone not currently ON the shift. No slice to openSpots — this is the
  // last ask, so it goes wide, and the accepts that reach the target close the
  // rest via markFullyStaffed.
  const candidates = (pool ?? []).filter((c) => !onShift.has(c.id));
  if (candidates.length === 0) {
    return emptyOffer(shift.shift_date, openSpots, false);
  }

  const now = new Date().toISOString();
  const reopenedIds = new Set<string>();
  const assignments: { id: string; cleaner_id: string; offer_code?: string | null }[] = [];
  const fresh: typeof candidates = [];

  for (const c of candidates) {
    const row = rowByCleaner.get(c.id);
    if (!row) {
      fresh.push(c);
      continue;
    }
    const offer_code = gen4();
    await sb.from("shift_assignments")
      .update({
        status: "offered",
        offer_code,
        offered_at: now,
        tier_at_offer: c.tier,
        // Cleared so this re-offer gets a reminder of its own; the old stamp
        // belonged to the offer this one supersedes.
        reminder_sent_at: null,
        responded_at: null,
      })
      .eq("id", row.id);
    reopenedIds.add(row.id);
    assignments.push({ id: row.id, cleaner_id: c.id, offer_code });
  }

  if (fresh.length) {
    const { data: inserted } = await sb
      .from("shift_assignments")
      .insert(fresh.map((c) => ({
        shift_id: shiftId,
        cleaner_id: c.id,
        tier_at_offer: c.tier,
        status: "offered",
        offer_code: gen4(),
      })))
      .select("id, cleaner_id, offer_code");
    assignments.push(...(inserted ?? []));
  }

  const { offered, failedNames } = await deliverOffers(sb, shift, candidates, assignments, reopenedIds);

  if (offered.length > 0) {
    await sb.from("shifts").update({ status: "staffing" }).eq("id", shiftId);
  }
  return {
    count: offered.length,
    offered,
    shiftDate: shift.shift_date,
    openSpots,
    fullyStaffed: false,
    failed: failedNames.length,
    failedNames,
  };
}

// Mark a shift fully staffed and close + notify any remaining open offers.
export async function markFullyStaffed(sb: SupabaseClient, shiftId: string): Promise<void> {
  await sb
    .from("shifts")
    .update({ status: "fully_staffed", current_tier: null })
    .eq("id", shiftId);

  // Name the shift being closed — a cleaner may hold offers on several.
  const closed = await loadShift(sb, shiftId);
  const phrase = closed ? ` on ${prettyDateTime(closed.shift_date, closed.start_time)}` : "";
  const fullText = await renderTemplate(sb, "shift_full", `That shift${phrase} is now fully booked. Thanks!`, {
    shift_date: closed ? prettyDate(closed.shift_date) : "",
    start_time: closed ? prettyTime(closed.start_time) : "",
  });

  const { data: leftover } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id")
    .eq("shift_id", shiftId)
    .eq("status", "offered");

  for (const a of leftover ?? []) {
    const { data: cleaner } = await sb
      .from("cleaners").select("phone, is_active").eq("id", a.cleaner_id).maybeSingle();
    // Don't message a cleaner who is currently Inactive; their offer is still
    // closed below.
    if (cleaner?.phone && cleaner.is_active) await sendMessage(cleaner.phone, fullText);
  }
  if ((leftover ?? []).length) {
    await sb
      .from("shift_assignments")
      .update({ status: "no_response" })
      .eq("shift_id", shiftId)
      .eq("status", "offered");
  }
}

// Re-evaluate staffing; mark fully_staffed if the accepted count met the target.
export async function recomputeStaffing(sb: SupabaseClient, shiftId: string): Promise<boolean> {
  const shift = await loadShift(sb, shiftId);
  if (!shift || shift.status === "cancelled") return false;
  const accepted = await acceptedCount(sb, shiftId);
  // Full once accepted cleaners fill every cleaner slot (the team lead is extra,
  // not counted against required_cleaners).
  if (accepted >= shift.required_cleaners) {
    await markFullyStaffed(sb, shiftId);
    return true;
  }
  return false;
}

// --- Inbound reply handlers (used by whatsapp-inbound) ----------------------

export async function acceptOffer(
  sb: SupabaseClient,
  assignmentId: string,
): Promise<"accepted" | "already_full" | "closed"> {
  const { data: a } = await sb
    .from("shift_assignments")
    .select("id, shift_id, cleaner_id, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return "closed";

  const shift = await loadShift(sb, a.shift_id);
  if (!shift || shift.status === "cancelled" || shift.status === "fully_staffed") return "closed";

  // First-come wins: if the cleaner slots are already full, this accept loses.
  if ((await acceptedCount(sb, a.shift_id)) >= shift.required_cleaners) {
    await sb.from("shift_assignments")
      .update({ status: "no_response", responded_at: new Date().toISOString() })
      .eq("id", assignmentId);
    return "already_full";
  }

  await sb.from("shift_assignments")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", assignmentId);
  await recomputeStaffing(sb, a.shift_id);
  return "accepted";
}

export async function declineOffer(sb: SupabaseClient, assignmentId: string): Promise<void> {
  await sb.from("shift_assignments")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", assignmentId);
}

// The deeper of two tiers, either of which may be absent.
function maxTier(a: Tier | null, b: Tier | null): Tier | null {
  if (!a) return b;
  if (!b) return a;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

// Deepest tier this shift has ever had an offer at, read off the assignment
// rows. NOT from shifts.current_tier alone: markFullyStaffed nulls that field
// when a shift fills, so once a shift has been full the tier it reached is only
// recoverable from the offers themselves — and that is exactly the moment a
// cancellation needs to know it.
async function deepestTierOffered(sb: SupabaseClient, shiftId: string): Promise<Tier | null> {
  const { data } = await sb
    .from("shift_assignments")
    .select("tier_at_offer")
    .eq("shift_id", shiftId)
    .not("tier_at_offer", "is", null);
  let best: Tier | null = null;
  for (const r of data ?? []) {
    const t = r.tier_at_offer as Tier;
    if (!TIER_RANK[t]) continue;
    best = maxTier(best, t);
  }
  return best;
}

// Cancel an accepted/offered assignment and decide what the shift is owed next.
//
// The decision ignores staffing status entirely — fully_staffed, staffing and
// understaffed all behave the same. What it asks is whether the OFFER CHAIN has
// anywhere left to go:
//
//   • a tier still has someone free -> "waiting". Free the spot and stop. Every
//     escalation recomputes openSpots when it runs, so the next one covers the
//     freed spot on its own. Blasting now would jump those cleaners' turn and
//     defeat the tiering.
//   • no tier has anyone left     -> "reoffered". Everyone has been asked once
//     and there is no later tier to fall back on, so re-ask everyone who is not
//     on the shift.
export type CancelOutcome = "reoffered" | "waiting" | "closed";

export async function cancelOffer(sb: SupabaseClient, assignmentId: string): Promise<CancelOutcome> {
  const { data: a } = await sb
    .from("shift_assignments")
    .select("shift_id")
    .eq("id", assignmentId)
    .maybeSingle();
  await sb.from("shift_assignments")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (!a) return "closed";

  const shift = await loadShift(sb, a.shift_id);
  if (!shift || shift.status === "cancelled") return "closed";

  // Where the shift is up to. Read from the offer rows as well as current_tier,
  // because markFullyStaffed nulls current_tier when a shift fills — so once a
  // shift has been full, the rows are the only record of the tier it reached.
  const reached = maxTier(await deepestTierOffered(sb, a.shift_id), shift.current_tier ?? null);

  // Reopen a filled shift, restoring that tier. current_tier is how the
  // escalation jobs FIND a shift; left null, a reopened shift is invisible to
  // them and stalls in `staffing` with the spot open.
  if (shift.status === "fully_staffed") {
    await sb.from("shifts")
      .update({ status: "staffing", current_tier: reached })
      .eq("id", a.shift_id);
  }

  if (await nextOfferableTier(sb, a.shift_id, reached)) return "waiting";
  await reofferToUnaccepted(sb, a.shift_id);
  return "reoffered";
}

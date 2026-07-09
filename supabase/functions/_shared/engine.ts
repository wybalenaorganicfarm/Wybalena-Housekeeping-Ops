// Assignment engine — the shared heart of the system.
// Reused by the cron jobs (offer-tier-1, escalate-tier-2/3, remind-nonresponders)
// and the whatsapp-inbound webhook. All writes use the service-role client.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendButtons, sendMessage } from "./adapters/whatsapp.ts";

export type Tier = "tier_1" | "tier_2" | "tier_3";

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
  phone: string,
  shift: ShiftRow,
  assignmentId: string | undefined,
) {
  const time = shift.start_time.slice(0, 5);
  const body =
    `*SHIFT DETAILS*\n\n📅 Date: ${shift.shift_date}\n⏰ Time: ${time}\n\n` +
    `Tap *Accept* to take this shift, or *Decline* to pass.`;
  return await sendButtons(
    phone,
    body,
    [
      { id: `accept:${assignmentId}`, title: "✅ Accept" },
      { id: `decline:${assignmentId}`, title: "❌ Decline" },
    ],
    {
      header: "🧹 New Cleaning Shift Available",
      footer: "Wybalena Organic Farm",
      fallbackText: `New cleaning shift on ${shift.shift_date} at ${time}. ` +
        `Please open WhatsApp and tap Accept or Decline on the offer.`,
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
): Promise<boolean> {
  if (!phone || !assignmentId) return false;
  const res = await sendOfferMessage(phone, shift, assignmentId);
  if (!res.ok) return false;
  if (res.providerMessageId) {
    await sb.from("shift_assignments")
      .update({ offer_message_id: res.providerMessageId })
      .eq("id", assignmentId);
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
): Promise<"offered" | "error" | "send_failed"> {
  const shift = await loadShift(sb, shiftId);
  if (!shift || shift.status === "cancelled") return "error";

  const { data: cleaner } = await sb
    .from("cleaners").select("id, phone, tier, is_team_leader").eq("id", cleanerId).maybeSingle();
  if (!cleaner) return "error";
  // The team lead is auto-assigned to every shift and is never offered/re-offered.
  if (cleaner.is_team_leader) return "error";

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
  const ok = await sendAndRecordOffer(sb, cleaner.phone, shift, row?.id);
  if (!ok) {
    if (row?.id) await sb.from("shift_assignments").delete().eq("id", row.id);
    return "send_failed";
  }

  // Reflect that the shift is actively being staffed (only once delivered).
  if (shift.status === "pending_confirmation" || shift.status === "confirmed") {
    await sb.from("shifts")
      .update({ status: "staffing", current_tier: shift.current_tier ?? cleaner.tier })
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
// offerAllRemaining. `inserted` maps cleaner_id -> the assignment row just created.
async function deliverOffers(
  sb: SupabaseClient,
  shift: ShiftRow,
  candidates: { id: string; full_name: string; phone: string | null }[],
  inserted: { id: string; cleaner_id: string }[],
): Promise<{ offered: { id: string; full_name: string }[]; failedIds: string[]; failedNames: string[] }> {
  const byId = new Map(inserted.map((r) => [r.cleaner_id, r]));
  const offered: { id: string; full_name: string }[] = [];
  const failedIds: string[] = [];
  const failedNames: string[] = [];
  for (const c of candidates) {
    const row = byId.get(c.id);
    const ok = await sendAndRecordOffer(sb, c.phone, shift, row?.id);
    if (ok) offered.push({ id: c.id, full_name: c.full_name });
    else {
      if (row?.id) failedIds.push(row.id);
      failedNames.push(c.full_name);
    }
  }
  // Undeliverable offers must not linger as "offered" — they'd block the cleaner
  // from being re-offered next run and hold the shift in a false "staffing" state.
  if (failedIds.length) {
    await sb.from("shift_assignments").delete().in("id", failedIds);
  }
  return { offered, failedIds, failedNames };
}

// Offer a shift to up to `openSpots` available cleaners in the given tier.
// Returns the offered cleaners. Sets the shift to staffing/current_tier.
export async function offerTier(
  sb: SupabaseClient,
  shiftId: string,
  tier: Tier,
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
    .select("id, cleaner_id");

  // Outbound offers: interactive Accept/Decline buttons whose payload carries the
  // assignment id, so the inbound webhook maps the tap straight to this row.
  // Undeliverable offers are rolled back inside deliverOffers.
  const { offered, failedNames } = await deliverOffers(sb, shift, candidates, inserted ?? []);

  // Only flag the shift as being staffed once at least one offer actually landed;
  // if every send failed the shift stays put so the next run retries cleanly.
  if (offered.length > 0) {
    await sb
      .from("shifts")
      .update({ status: "staffing", current_tier: tier })
      .eq("id", shiftId);
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

// Re-offer a freed spot to ALL remaining available cleaners, across every tier
// (not just the shift's current tier) and without capping to open spots. Used
// when a cleaner cancels: we blast the offer wide so the gap fills fast, and the
// first accept that reaches the target auto-closes the rest via markFullyStaffed.
export async function offerAllRemaining(
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
    .select("cleaner_id")
    .eq("shift_id", shiftId);
  const taken = new Set((existing ?? []).map((r) => r.cleaner_id));

  const { data: pool } = await sb
    .from("cleaners")
    .select("id, full_name, phone, tier")
    .eq("is_active", true)
    .eq("is_team_leader", false)
    .order("tier")
    .order("full_name");

  const candidates = (pool ?? []).filter((c) => !taken.has(c.id));
  if (candidates.length === 0) {
    return emptyOffer(shift.shift_date, openSpots, false);
  }

  const rows = candidates.map((c) => ({
    shift_id: shiftId,
    cleaner_id: c.id,
    tier_at_offer: c.tier,
    status: "offered",
    offer_code: gen4(),
  }));
  const { data: inserted } = await sb
    .from("shift_assignments")
    .insert(rows)
    .select("id, cleaner_id");

  const { offered, failedNames } = await deliverOffers(sb, shift, candidates, inserted ?? []);

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

  const { data: leftover } = await sb
    .from("shift_assignments")
    .select("id, cleaner_id")
    .eq("shift_id", shiftId)
    .eq("status", "offered");

  for (const a of leftover ?? []) {
    const { data: cleaner } = await sb
      .from("cleaners").select("phone").eq("id", a.cleaner_id).maybeSingle();
    if (cleaner?.phone) await sendMessage(cleaner.phone, "That shift is now fully booked. Thanks!");
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

// Cancel an accepted/offered assignment and re-offer the freed spot to ALL
// remaining available cleaners (every tier). The first accept that hits the
// target auto-closes the rest via markFullyStaffed.
export async function cancelOffer(sb: SupabaseClient, assignmentId: string): Promise<void> {
  const { data: a } = await sb
    .from("shift_assignments")
    .select("shift_id")
    .eq("id", assignmentId)
    .maybeSingle();
  await sb.from("shift_assignments")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (!a) return;

  const shift = await loadShift(sb, a.shift_id);
  if (!shift || shift.status === "cancelled") return;
  // Reopen if it had been marked full.
  if (shift.status === "fully_staffed") {
    await sb.from("shifts").update({ status: "staffing" }).eq("id", a.shift_id);
  }
  await offerAllRemaining(sb, a.shift_id);
}

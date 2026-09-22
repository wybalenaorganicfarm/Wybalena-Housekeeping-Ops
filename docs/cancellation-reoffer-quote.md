# Quote — cancellation re-offer fix + cooling-off period + new message template

**Reference:** 4 October 2026 shift; Mai El-khodr and Cassie Douglas re-offered a shift
they had cancelled. Investigation: `docs/cancellation-reoffer-investigation.md`.
**Date:** 22 September 2026

---

## Scope

Three pieces of work, priced separately so any can be dropped.

### A — Stop re-offering a shift to the cleaner who just cancelled it

The confirmed defect. `reofferToUnaccepted` excludes only cleaners currently on the
shift, so a cleaner who cancelled seconds earlier is treated as "available" and re-offered.

Work:
- New `self_cancelled_at` column on `shift_assignments` to tell a cleaner's own
  cancellation apart from an admin removal — today both write the same status.
- `cancelOffer` stamps it; `reofferToUnaccepted` honours it.
- `whatsapp-inbound` passes the flag. Admin removals (`cancel-accepted`) do not,
  so those cleaners stay eligible.

### B — Cooling-off period instead of permanent exclusion

Per your note, the exclusion lapses after a set period rather than lasting forever.

Work:
- Admin-configurable window (default proposed: 48 hours) on the Settings page,
  alongside the existing schedule controls.
- Exclusion check becomes time-based rather than a flat flag.
- New date helper for hour-level comparison — the existing helpers work in whole
  days only.

**One thing to be aware of before choosing the window.** Nothing re-runs offers on a
timer. Once a shift's tier chain is exhausted, the wide sweep only fires when
*something else* happens — another cancellation, or an escalation. So a cleaner whose
cooling-off expires does not automatically get re-asked; she becomes eligible for the
*next* sweep, whenever that occurs. In the 4 October case that was four days later.

This is not an argument against the window — it is the safer default and matches how
you described it. But if the intent is "ask her again once she's had time to think,"
that needs a small scheduled re-check, which is priced as optional item D.

### C — New message template: "a spot has opened up"

So a cleaner who previously declined understands why the same shift is back.

Work:
- New `reoffer_after_cancellation` template row, seeded by migration, editable on the
  Templates page exactly like the existing ones (wording, header, footer, plain-text
  fallback, button labels, reset-to-default).
- Offer send path takes a variant so the wide sweep uses this template while normal
  tier offers keep the standard one. Touches four functions in the shared engine;
  no restructuring.
- Same `{{shift_date}}`, `{{start_time}}` and `{{offer_code}}` variables as the
  standard offer, so the Accept/Decline buttons and the offer reference behave
  identically.

Proposed starting wording (fully editable afterwards):

> **A spot has opened up** 🔄
>
> Someone has cancelled, so the cleaning shift on {{shift_date}} at {{start_time}}
> is available again.
>
> You may have seen this shift before — we're asking everyone again now a place
> has come free.
>
> 🔖 Ref: {{offer_code}}
>
> Tap **Accept** to take it, or **Decline** to pass.

### D — Optional: scheduled re-check after cooling-off

Only needed if you want a cleaner actively re-asked once her window expires, rather
than waiting for the next sweep. A small daily job that finds understaffed shifts with
expired cooling-off periods and runs one offer round.

---

## Pricing

| Item | Work | Estimate |
|---|---|---|
| **A** | Cancellation exclusion (the defect fix) | **[X] hours** |
| **B** | Cooling-off window + Settings control | **[X] hours** |
| **C** | New "spot opened up" template + send-path variant | **[X] hours** |
| **D** | *Optional* — scheduled re-check after expiry | **[X] hours** |
| | Testing, staging verification, deployment | **[X] hours** |
| | **Total (A+B+C)** | **[X] hours / [currency]** |

> Fill in the rates before sending. A, B and C are intended to ship together —
> B without C is the scenario the client specifically flagged as confusing for
> cleaners, and C without A does not fix anything.

---

## Assumptions

- Default cooling-off window of **48 hours**, changeable in Settings without a
  redeploy. Confirm if you would prefer a different default.
- Template wording above is a starting point; Ashleigh can reword it in the app at
  any time, as with every other message.
- Admin removals are unaffected — if Ashleigh takes someone off a shift, that cleaner
  remains immediately offerable.
- The exclusion is per shift. Cancelling 4 October has no effect on 11 October.
- Forward-only. The six already-rewritten rows from 19 September are not altered;
  that shift is correctly staffed.

## Delivery notes

- Database migration must be applied before the updated functions.
- Deno is not installed on the current dev machine, so edge functions will be verified
  on staging before going live.
- Scope confirmed as a single occurrence across all shifts to date, so this is a
  correctness fix rather than an emergency.

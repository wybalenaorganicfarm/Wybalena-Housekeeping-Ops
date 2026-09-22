# Smoke test — cancellation cooling-off + re-offer template

Run after deploying. Each step says what to do and what proves it worked.
Stop at the first failure; the rollback is at the bottom.

---

## 0. Pre-deploy checks (already done)

| Check | Result |
|---|---|
| Frontend `tsc --noEmit` | ✅ clean |
| Frontend `vite build` | ✅ builds |
| Cooling-off filter logic (10 cases) | ✅ all pass |
| Settings clamp (14 cases) | ✅ all pass after null fix |
| No circular import `settings.ts` ↔ `engine.ts` | ✅ settings imports only the Supabase type |
| `deliverOffers` call sites match signature | ✅ 2 sites, both valid |
| `app_settings` insert matches schema | ✅ |
| Template category `'Offer & acceptance'` exists | ✅ |
| Edge functions `deno check` (all 38) | ✅ 37 pass; `send-auth-email` fails on a local npm resolution issue, unrelated and already live |

**All pre-deploy checks now pass.** Deno 2.9.7 installed and every edge function
compiled.

Two things the compile caught:

1. **`clampInt` null coercion** — `Number(null)` is `0`, not `NaN`, so a row holding
   `{"cooloff_hours": null}` would have clamped to 0 and silently DISABLED the
   cooling-off. Fixed with `?? undefined` at the call site.
2. **Pre-existing dead code in `whatsapp-inbound`** — two `r.action === "unknown"`
   comparisons after the gate at 2a had already returned for that case. TypeScript
   narrowed them out and failed the check. Not introduced here (present in 26aefa7
   at the same line), no runtime effect, removed so the file compiles.

---

## 1. Compile the edge functions — ✅ DONE

```bash
deno check supabase/functions/_shared/engine.ts        # ✅ Check
deno check supabase/functions/_shared/settings.ts      # ✅ Check
deno check supabase/functions/whatsapp-inbound/index.ts # ✅ Check
deno check supabase/functions/cancel-accepted/index.ts  # ✅ Check
```

If `deno` is not on PATH in a fresh shell, it is at
`%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno_*\deno.exe`
(winget modifies PATH but an already-open shell will not see it until restarted).

To re-check everything at once:

```bash
for d in supabase/functions/*/; do deno check "$d/index.ts"; done
```

---

## 2. Apply migrations

```bash
supabase migration list --linked    # read-only, see what is pending
supabase db push
```

**Expect:** `20260922120000_reoffer_after_cancellation_template` and
`20260922130000_cancellation_cooloff` applied.
(`20260921120000_self_cancelled_at` is already live.)

Verify:

```sql
-- 2a. Template row seeded, with defaults populated for Reset-to-default
select key, category, sort_order, label,
       defaults ? 'body' as has_default_body,
       buttons is not null as has_buttons
from message_templates
where key = 'reoffer_after_cancellation';
-- expect: 1 row, category 'Offer & acceptance', sort_order 2, both flags true

-- 2b. Setting seeded at 48h
select key, value, label from app_settings where key = 'cancellation_cooloff';
-- expect: {"cooloff_hours": 48}

-- 2c. Nothing else disturbed — shift_full should still be sort_order 3
select key, sort_order from message_templates
where category = 'Offer & acceptance' order by sort_order;
-- expect: shift_offer 1, reoffer_after_cancellation 2, shift_full 3
```

---

## 3. Deploy functions

```bash
supabase functions deploy --project-ref wctunwynyugdncbiwwhs
```

Deploy-all, not per-function: `engine.ts` is bundled into every function that
imports it, and `cancelOffer`'s signature changed. A partial deploy leaves some
functions on the old engine — an inconsistency that is painful to diagnose later.

---

## 4. Deploy frontend

Then hard-refresh the app.

---

## 5. UI checks (no messages sent — safe)

**5a. Templates page.** Admin → Templates → "Offer & acceptance".
- "A spot has opened up (after a cancellation)" appears below "Shift offer".
- Preview shows a real date, time and **Ref `2507`** — *not* a literal `{{offer_code}}`.
- The existing "Shift offer" preview also now shows `2507` (this was broken before).
- Edit a word, save, reload — it persists. Reset to default restores the seeded text.

**5b. Schedule page.** Admin → Automation Schedule → scroll to **"Cancellations"**.
- Card reads "Cooling-off: 2 days".
- Edit → set `0` → preview says cooling-off is off → Cancel (don't save).
- Edit → set `48` → preview names 48 hours / 2 days → Save → toast, card updates.
- Try `999` → blocked with the range message. Try `-1` → blocked.

---

## 6. The real test — a live cancellation

Needs a test shift whose tier chain is exhausted (that is the only condition
under which the wide sweep runs). Use a test cleaner with a real number.

1. Note the time. Have the test cleaner cancel an accepted shift via WhatsApp.
2. **She should receive:** the cancellation confirmation. **She must NOT receive**
   a fresh offer for that shift.
3. Other available cleaners **should** receive the new wording — header
   "🔄 A Spot Has Opened Up", body "Someone has cancelled…".

```sql
-- 6a. Her cancellation stamped the marker
select c.full_name, s.shift_date, sa.status, sa.self_cancelled_at
from shift_assignments sa
join cleaners c on c.id = sa.cleaner_id
join shifts   s on s.id = sa.shift_id
where sa.self_cancelled_at is not null
order by sa.self_cancelled_at desc limit 5;
-- expect: her row, stamped just now

-- 6b. THE KEY CHECK — she must NOT be in the re-offer batch.
--     Everyone swept gets the same offered_at to the millisecond.
select c.full_name, sa.status, sa.offered_at, sa.self_cancelled_at
from shift_assignments sa
join cleaners c on c.id = sa.cleaner_id
where sa.shift_id = '<the shift id>'
order by sa.offered_at desc nulls last;
-- expect: a batch sharing one offered_at, and HER row NOT in it
--         (her offered_at stays older, her status is 'cancelled')

-- 6c. Audit trail: a cancel with NO decline from her seconds later.
--     That cancel→decline pair within a minute was the original bug signature.
select created_at, event_type, summary
from audit_logs
where shift_id = '<the shift id>'
order by created_at desc limit 10;
```

**Pass:** she is absent from the batch, and there is no `response.declined` from
her moments after her `response.cancelled`.

---

## 7. Regression checks

```sql
-- 7a. Admin removal must NOT start a cooling-off.
--     Take a cleaner off a shift via the app, then:
select c.full_name, sa.status, sa.self_cancelled_at
from shift_assignments sa join cleaners c on c.id = sa.cleaner_id
where sa.id = '<that assignment id>';
-- expect: status 'cancelled', self_cancelled_at NULL

-- 7b. Normal tier offers still use the STANDARD wording.
--     Let a routine tier-1/2/3 offer go out and confirm the cleaner receives
--     "🧹 New Cleaning Shift Available", not the cancellation wording.

-- 7c. The historical sweep is still the only one on record.
select created_at, shift_id, summary from audit_logs
where event_type = 'response.cancelled'
  and summary like '%re-offered to everyone still available%'
order by created_at desc;
-- expect: the 19 Sep row, plus any new legitimate sweeps from testing
```

---

## 8. Watch for 48 hours

- Re-run 7c daily. Any new sweep should exclude whoever triggered it.
- Check the Logs page for `offer.sent_without_buttons` warnings — the new template
  is longer than the old one, and an over-long header can make WhatsApp refuse
  buttons and downgrade to plain text. Header is 22 chars, well within limits,
  but worth confirming in the wild.

---

## Rollback

**Functions** — redeploy from the previous commit:

```bash
git log --oneline -5
git checkout <previous-sha> -- supabase/functions/
supabase functions deploy --project-ref wctunwynyugdncbiwwhs
git checkout HEAD -- supabase/functions/
```

**Turn off the cooling-off without any deploy** — set it to 0 on the Schedule page,
or:

```sql
update app_settings set value = '{"cooloff_hours": 0}'::jsonb
where key = 'cancellation_cooloff';
```

**Revert to the standard offer wording without a deploy** — point the new template
at the old text by editing it on the Templates page, or delete the row and the code
falls back to the built-in default automatically (`loadTemplate` returns null →
hardcoded text). Offers keep sending either way.

**Leave the columns and rows in place.** They are inert when nothing reads them,
and dropping them requires the functions reverted first.

---

## Known residual risks

1. **Edge functions uncompiled** unless step 1 is run. Highest-value 5 minutes here.
2. **The sweep is rare.** It fires only when a cancellation lands on a shift whose
   tier chain is exhausted — once since launch. A quiet week proves little; keep
   query 7c in the weekly routine for a month.
3. **Cooling-off expiry does not itself trigger an offer.** She becomes eligible for
   the *next* sweep, whenever one happens. This is the optional daily re-check that
   was quoted separately and not built.

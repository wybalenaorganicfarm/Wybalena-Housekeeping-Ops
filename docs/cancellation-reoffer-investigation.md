# Cancelled cleaners re-offered their own shift — investigation

**Shift:** Sunday 4 October 2026 (offer code `0410`), Standard Clean, 6 cleaners required
**Reported by:** client — "Mai cancelled her shift 04/10 and then it sent out the shift
offers back to her again... This has happened again for Cassie canceling shift 04/10 also"
**Status:** root cause confirmed from `audit_logs` + `shift_assignments`. Fix not yet applied.

---

## 1. What the evidence shows

### Mai El-khodr — 19 September

From `audit_logs`:

```
11:15:30  response.cancelled   Mai El-khodr cancelled their spot on Sunday 4th October 2026.
                               All tiers had already been offered, so the shift has been
                               re-offered to everyone still available. Admin and team lead alerted.

11:15:58  response.declined    Mai El-khodr declined the shift on Sunday 4th October 2026.
                               Removed from offer list.
```

She cancelled and, 28 seconds later, declined the same shift. She could only decline
something she had just been offered.

Her `shift_assignments` row:

| column | value | meaning |
|---|---|---|
| `created_at` | 2026-09-09 00:08:58 | her original offer (manual-assign, 9 Sep) |
| `offered_at` | **2026-09-19 11:15:13** | rewritten — a NEW offer on the day she cancelled |
| `responded_at` | 2026-09-19 11:15:56 | her decline of that new offer |
| `status` | `declined` | |

`offered_at` is ten days later than `created_at`: the row was re-opened in place.

### The batch write

Six rows share `offered_at` = `2026-09-19 11:15:13.034` exactly — Cassie Douglas,
Denny Tan-Ning Lu, Karin Gisler, Mai El-khodr, Michelle Campbell, Rebecca Korge.
Identical to the millisecond means one write from one function call, not six offers.

All six also carry `offer_code` = `0410`, and their `created_at` values span 31 Aug
to 9 Sep — pre-existing rows, re-opened together.

### Cassie Douglas — cancelled 15 Sep, re-offered 19 Sep

```
15 Sep 01:16:52  response.cancelled  Cassie Douglas cancelled their spot...
                                     The shift has not reached Tier 3 yet, so the freed
                                     spot is included in the next scheduled escalation.

19 Sep 11:32:39  response.declined   Cassie Douglas declined the shift...
```

Her own cancellation did NOT re-offer (the `waiting` branch). She was pulled back in
four days later by **Mai's** cancellation sweep — her `offered_at` is also 11:15:13.

So the client's "this happened again for Cassie" is not a second incident. One sweep
re-offered two already-cancelled cleaners at once.

---

## 2. Root cause

`whatsapp-inbound` → `cancelOffer()` → `reofferToUnaccepted()` in
`supabase/functions/_shared/engine.ts`.

`cancelOffer` sets the row to `cancelled`, then:

```ts
if (await nextOfferableTier(sb, a.shift_id, reached)) return "waiting";
await reofferToUnaccepted(sb, a.shift_id);   // <-- tier chain exhausted
return "reoffered";
```

`reofferToUnaccepted` builds its candidate list by excluding only cleaners who are
currently `accepted`:

```ts
const onShift = new Set(rows.filter((r) => r.status === "accepted").map((r) => r.cleaner_id));
...
const candidates = (pool ?? []).filter((c) => !onShift.has(c.id));
```

A cleaner who has just cancelled is no longer `accepted`, so she is back in the pool
and is re-offered immediately. This is deliberate — the function's own doc comment says
it re-asks "the ones who declined, the ones who never replied, **and the one whose
cancellation triggered it**."

The audit summary string `"All tiers had already been offered, so the shift has been
re-offered to everyone still available"` is the `outcome === "reoffered"` branch in
`whatsapp-inbound/index.ts`, printed only when this path runs. It appears verbatim in
Mai's cancellation log line.

### Why it looks intermittent

It only fires once the tier chain is exhausted (`nextOfferableTier` returns null).
Cancel a shift still at tier 1 or 2 and you get `waiting` — no re-offer, which is what
Cassie saw on 15 Sep. Cancel a fully-escalated shift and it bounces straight back,
which is what Mai saw on 19 Sep. Same code, two outcomes.

---

## 3. Why the first check came back clean

The obvious query — `offered_at > responded_at` — returns false for every row and
looks like an all-clear. It cannot work: `reofferToUnaccepted` **overwrites**
`offered_at` on the existing row, so the timestamp you would compare against is
destroyed by the re-offer itself. The victim then responds to the new offer, leaving
`responded_at` later than `offered_at` — indistinguishable from a normal offer.

The correct signal is `offered_at` significantly later than `created_at`, plus several
rows sharing one `offered_at` to the millisecond.

---

## 4. Verification queries

```sql
-- 4.1 The batch write. Rows re-opened in place: offered_at well after created_at,
--     many rows sharing one timestamp. This is the detection query.
select c.full_name, sa.status, sa.created_at, sa.offered_at, sa.responded_at,
       sa.offer_code, sa.tier_at_offer
from shift_assignments sa
join cleaners c on c.id = sa.cleaner_id
join shifts   s on s.id = sa.shift_id
where s.shift_date = date '2026-10-04'
order by sa.offered_at, c.full_name;

-- 4.2 Cancel immediately followed by a decline from the SAME cleaner on the SAME
--     shift — the fingerprint of being re-offered what you just dropped.
select a1.created_at as cancelled_at,
       a2.created_at as declined_at,
       a2.created_at - a1.created_at as gap,
       a1.summary
from audit_logs a1
join audit_logs a2
  on a2.shift_id   = a1.shift_id
 and a2.cleaner_id = a1.cleaner_id
 and a2.event_type = 'response.declined'
 and a2.created_at > a1.created_at
 and a2.created_at < a1.created_at + interval '10 minutes'
where a1.event_type = 'response.cancelled'
order by a1.created_at desc;

-- 4.3 Every cancellation that triggered the wide sweep, across all shifts.
--     Scope check: how often has this fired?
select created_at, shift_id, summary
from audit_logs
where event_type = 'response.cancelled'
  and summary like '%re-offered to everyone still available%'
order by created_at desc;
```

### Results (run 21 Sep 2026)

Query 4.3 returned **one row** — the Mai cancellation on 19 Sep. The structural query
(re-opened rows, batched, independent of log wording) also returned **one batch**
across all shifts:

```
shift_date  swept_at                  cleaners_reoffered  who
2026-10-04  2026-09-19 11:15:13.034+00  6                 Cassie Douglas, Denny Tan-Ning Lu,
                                                          Karin Gisler, Mai El-khodr,
                                                          Michelle Campbell, Rebecca Korge
```

**Scope: this has fired exactly once.** Not a long-running silent fault — one event
that generated both client complaints.

Of the six swept up, only two were wrong:

| Cleaner | Reason in sweep | Correct? |
|---|---|---|
| Mai El-khodr | cancelled 28s earlier | **No — the bug** |
| Cassie Douglas | cancelled 15 Sep | **No — the bug** |
| Denny Tan-Ning Lu | declined 31 Aug | Yes |
| Michelle Campbell | declined 31 Aug | Yes |
| Rebecca Korge | declined 1 Sep | Yes |
| Karin Gisler | never responded | Yes |

The sweep otherwise did its job: Maya Maskit accepted at 21:15 the same day and the
shift returned to 6/6. The mechanism is sound — it needs the one exclusion, nothing more.
This also confirms Cassie was never a separate incident, only collateral from Mai's
cancellation four days after her own.

---

## 5. Proposed fix (not yet applied)

Mark who cancelled, and exclude self-cancellers from the sweep for that shift only.

1. **Migration** — add `self_cancelled_at timestamptz` to `shift_assignments`, nullable.
   Distinguishes a cleaner's own WhatsApp cancel from an admin removal, which today
   both write a bare `cancelled`.

2. **`cancelOffer(sb, assignmentId, selfCancelled = false)`** — stamp the column when
   the cleaner cancelled; leave null for admin removals.

3. **`reofferToUnaccepted`** — exclude cleaners with `self_cancelled_at` set on this shift.

4. **`whatsapp-inbound`** — pass `true`. `cancel-accepted` (admin removal) passes nothing.

### Boundaries this deliberately keeps

- **Admin removal stays eligible.** Being taken off a shift says nothing about
  availability; only the cleaner's own cancel does.
- **Scoped per shift.** Cancelling 4 Oct must not make her unofferable for 11 Oct.
- **Manual override clears the marker.** If Ashleigh knows she has freed up,
  `manual-assign` still works.

### Open question for the client

A cleaner who cancels is excluded from that shift's automatic re-offers **permanently**,
not for a cooling-off window. If Ashleigh wants her back on, it is a manual assign.
Worth confirming that matches expectations before shipping.

### Pre-deploy notes

- Migration must be applied **before** the functions, or the `self_cancelled_at` write
  fails on an unknown column.
- Deno is not installed on the dev machine, so the edge functions are unverified beyond
  review — run `deno check` or deploy to staging first.
- The fix is forward-only. It does not repair the six rows already rewritten on 19 Sep.

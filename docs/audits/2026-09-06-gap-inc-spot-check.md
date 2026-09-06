# Gap Inc. spot-check — does the blast-radius census's n=1 hold?

**Date:** 2026-09-06. **TASKS.md 🔴 Now item:** "Spot-check: known Gap Inc. orders
(Old Navy + additional Gap orders owner knows are in the DB) to test whether the
2026-09-06 blast-radius census undercounted the affected population."

**Method:** read-only Prisma query (`retailer IN ('Gap','Old Navy','Banana
Republic','Athleta')`, `emailType = 'order_confirmation'`) + the app's own
`decrypt()` helper (`textBody`, for char count/context) + inspection of the plaintext
`extractionNotes` field. **Zero writes. Zero Anthropic/model calls. No re-run of the
census, no widened predicate query — this is per-row inspection of a small, named
set.** Re-runnable: `npx tsx scripts/audits/gap-inc-spot-check.ts`.

**Candidate set:** the DB currently has 5 distinct Gap Inc. orders (by `orderNumber`,
across `Gap`/`Old Navy`/`Banana Republic`/`Athleta` — no Banana Republic or Athleta
rows exist yet, all 5 are Gap or Old Navy): `1R1KXD3` (Old Navy), `1RJ3T2M` (Gap),
`1RL39WM` (Gap), `1RM570N` (Gap), `1RYJR48` (Gap, the original diagnostic's row). All
5 inspected — this covers every known Gap Inc. order in the DB, not a sample of them.

---

## Summary verdict

**The census's n=1 does not hold. The affected population is at least 4× larger than
the census reported, within the known Gap Inc. set.** 3 additional Gap orders
(`1RJ3T2M`, `1RL39WM`, `1RM570N`) show the identical mechanism fingerprint as
`1RYJR48` — a ~1,000-1,050-char boilerplate-only `textBody`, `extractionNotes`
explicitly stating "Order number read from subject line," no retry-recovery note, and
`orderDate`/`orderTotal`/`lineItems` all null. All 3 dropped out of the census's
pattern-match predicate for the same reason: `returnWindowDays` was populated to `30`
via an **unrelated fallback mechanism** — the web-search return-policy lookup
(`policySource: "web_lookup"`, `finalizeExtraction`'s `mayTriggerPolicyLookup` path,
confirmed present in all 3 rows' `extractionNotes`) — which runs independently of
body extraction whenever `returnWindowDays` comes back null and a retailer is known.
Gap's return policy is publicly documented, so this lookup reliably succeeds even when
the body-extraction mechanism has completely failed, silently filling in the one
field the census's predicate required to be null. **The census's predicate itself was
too strict** — exactly possibility (2) in the Now item's framing — not because the
underlying mechanism is rarer than reported, but because a second, unrelated rescue
path partially masks it from that specific query shape.

## Per-order findings

| Order | Retailer | needsReview | orderDate | orderTotal | returnWindowDays | lineItems | policySource | textBody chars | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `1R1KXD3` | Old Navy | false | 2026-06-22 (header-inferred) | $433.64 | 30 | 5 items | web_lookup | 16,559 | **Clean extraction** |
| `1RJ3T2M` | Gap | true | null | null | 30 | 0 | web_lookup | 1,022 | **Partial — mechanism fingerprint** |
| `1RL39WM` | Gap | true | null | null | 30 | 0 | web_lookup | 1,045 | **Partial — mechanism fingerprint** |
| `1RM570N` | Gap | true | null | null | 30 | 0 | web_lookup | 1,056 | **Partial — mechanism fingerprint** |
| `1RYJR48` | Gap | true | null | null | null | 0 | null | 1,049 | **Partial — mechanism fingerprint** (the original diagnostic row) |

### Old Navy `1R1KXD3` — clean extraction
`textBody` is 16,559 chars of real forwarded content (the "Fwd:" header plus the full
original email body survived, unlike the Gap rows). `extractionNotes` shows the order
total was computed from an explicit subtotal/promo/tax breakdown stated in the body,
order date was inferred from the forwarded-message header (a separate, legitimate
fallback — not this mechanism), and 5 real line items were extracted. `returnWindowDays`
came from a web lookup because the email itself didn't state a window, same as the
other 4 rows — but that's the only field that came from a fallback path here; every
other field reflects genuine body content. Not affected by the mechanism.

### Gap `1RJ3T2M`, `1RL39WM`, `1RM570N` — partial, mechanism fingerprint confirmed
All 3 `extractionNotes` explicitly state the order number was "read from subject
line" (`1RJ3T2M`: *"order number read from subject line"*; `1RL39WM`: *"Order number
read from subject line"*; `1RM570N`: *"the order number (from subject)"*) against a
`textBody` in the same 1,022–1,056 char range as `1RYJR48` (1,049 chars) — the same
Gap boilerplate-only template ("Order Confirmation: This is not your receipt... GAP
[link]... Click below to view this message from Gap in a web browser..."). None of the
3 rows' `extractionNotes` mention the retry-recovery note ("Order number recovered
from alternate body source on retry") — confirming, as with `1RYJR48`, that the
two-pass retry never fired, because `orderNumber` was already non-null after pass 1
(sourced from the subject) before the retry's gate was ever checked. `orderDate`,
`orderTotal`, and `lineItems` are null on all 3, exactly matching `1RYJR48`'s shape.
The only field that differs from `1RYJR48` is `returnWindowDays`, populated to `30` on
all 3 via `policySource: "web_lookup"` — a separate mechanism (Gap's policy is public
and gets looked up whenever `returnWindowDays` is null, independent of whether the
body extraction itself succeeded).

## Why the census missed these 3

The 2026-09-06 census's pattern-match predicate required
`orderDate IS NULL AND orderTotal IS NULL AND returnWindowDays IS NULL AND lineItems
empty`. `returnWindowDays` being non-null on `1RJ3T2M`/`1RL39WM`/`1RM570N` was enough
to exclude all 3 from the matched set, even though `orderDate`/`orderTotal`/`lineItems`
were null on all of them for the identical reason as `1RYJR48`. The web-search
return-policy lookup is a downstream, independent process from the body-extraction
retry — it doesn't know or care whether the fields it's filling in came from a healthy
extraction or a mechanism failure, so its success at recovering `returnWindowDays`
had the side effect of making 3 of 4 real instances invisible to a predicate that
required every body-dependent field, including that one, to be null.

## What this means for the count (not a re-census — reporting only what this spot-check covers)

Within the 5 known Gap Inc. orders, the mechanism-affected count is **4 of 5** (all
except the Old Navy row), not the 1 the census reported for its full 158-row baseline.
This spot-check does not re-run the census with a wider predicate and cannot state a
corrected number for the full 158-row population — that would require the predicate
itself to change (drop the `returnWindowDays IS NULL` condition, or check it
independently of the other three), which is explicitly out of scope here per the Now
item ("no re-run of the census with a wider predicate... that would be a re-census,
not a spot-check"). What this spot-check does establish: the true affected population
in the full baseline is **at least as large as, and plausibly several times larger
than, the census's reported n=1** — the exact number needs a follow-up census run with
a corrected predicate, not a fix decision made on the n=1 figure alone.

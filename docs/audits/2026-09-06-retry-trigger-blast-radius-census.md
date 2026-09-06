# Retry-trigger proxy-signal failure — blast-radius census

**Date:** 2026-09-06. **TASKS.md 🔴 Now item:** "Diagnostic: blast-radius census for the
retry-trigger proxy-signal failure surfaced by the 2026-09-06 Gap extraction
diagnostic."

**Method:** read-only Prisma queries (baseline count + pattern-match query) + the app's
own `decrypt()` helper (spot-check only, to read `textBody` context) + inspection of
the plaintext `extractionNotes` field. **Zero writes. Zero Anthropic/model calls.**
Re-runnable: `npx tsx scripts/audits/retry-trigger-blast-radius-census.ts`.

---

## Summary

The confirmed `orderNumber`-gate mechanism (the exact failure traced in the 2026-09-06
Gap diagnostic: pass 1 finds `orderNumber` from a non-body source, satisfying the
retry's sole gate before the thin body pass 1 actually used ever mattered) affects
**exactly 1 order in the current population** — the Gap row itself. The pattern-match
query surfaced a second row (Whole Foods Market) with the same *shape*
(`orderNumber` present, every body-content-dependent field null), but spot-check
inspection of its `extractionNotes` shows a different, unrelated cause: the email
genuinely never states an order date, line items, or return window (a grocery pickup
confirmation, not a body-selection failure) — correctly excluded from the confirmed
count. **The silent slice (matched pattern, not flagged for review) is 0** — both
matched rows already have `needsReview: true`, so the coverage-check net that missed
this class in general did not, in this instance, produce any additional
review-invisible rows. This is a narrow, contained finding, not a systemic one — see
the confidence-boundary and scoping-honesty notes below for exactly what this does and
doesn't establish.

## Step 1 — Baseline population

`Email` rows with `emailType = 'order_confirmation'`: **158**. Scoped to this type
because `orderDate`/`orderTotal`/`lineItems`/`returnWindowDays` are all fields the
extraction prompt is expected to populate for a genuine order confirmation — other
email types (`shipping_confirmation`, `return_label`, `delivery`, `refund`) don't
carry these fields as a matter of course, so including them would inflate the
pattern-match count with rows that were never candidates for this specific failure.

## Step 2 — Pattern-match query

Predicate: `orderNumber IS NOT NULL` AND `orderDate IS NULL` AND `orderTotal IS NULL`
AND `returnWindowDays IS NULL` AND (`lineItems IS NULL` OR `lineItems = []`), within
the Step 1 baseline.

**Matched: 2 of 158.**

Retailer breakdown (matched set, pre-mechanism-verification): Gap: 1, Whole Foods
Market: 1.

`retailerSource` breakdown (matched set, supporting color only — see the scoping-honesty
note below): `body_extraction`: 2. Neither matched row used `sender_fallback` or
`carrier_deferred` — this census found no evidence of a retailer-sourced variant of the
mechanism, though absence of evidence in a 2-row matched set is weak evidence of
absence (see confidence boundary).

## Step 3 — needsReview split and silent slice

- `needsReview = true` (flagged): **2** (both matched rows).
- `needsReview = false` (silent slice): **0.**

No silent-slice retailer breakdown to report — the set is empty. The hypothesis that
this failure class could produce review-invisible rows is not disproven by this
finding (2 rows is too small a population to generalize from), but in the population
that currently exists, it did not happen.

## Step 4 — Spot-check with `extractionNotes` inspection

Both matched rows were spot-checked (2 of 2 — this was exhaustive, not a sample; see
confidence boundary below for what that means for the count).

**Row 1 — Gap (`id=cmtkedq300001le04347677sj`).** `textBody`: 1,049 chars of pure
branding/boilerplate ("This is not your receipt," Gap homepage link, unsubscribe/view-
in-browser links). `extractionNotes`: *"...no order date, items, prices, totals, or
return policy information are present. Retailer identified as Gap from the body
branding and customer service address. **Order number read from subject line.**
needsReview is true because..."* — no retry-recovery note present ("Order number
recovered from alternate body source on retry" does not appear). **Verdict: MECHANISM
CONFIRMED** — notes explicitly attribute `orderNumber` to the subject line, and the
absence of the retry note confirms pass 2 never ran. This is the same row the prior
diagnostic traced in full.

**Row 2 — Whole Foods Market (`id=cmt33moae0003le048r2l187x`).** `textBody`: 2,629
chars — real content, not boilerplate ("Thank you for shopping with us... check in 5
minutes before..."). `extractionNotes`: *"This is a grocery pickup order confirmation
from Whole Foods Market (fulfilled via Amazon); the $205.28 figure is explicitly
labeled as a 'Payment Authorization'... so it was not used as orderTotal; **no line
items, order date, or return window are stated in the email**, triggering needsReview
because orderNumber is present but no return deadline can be determined..."* — no
mention of a non-body source for `orderNumber`, and no retry note. **Verdict:
SHAPE-MATCH, MECHANISM UNCONFIRMED** — the null fields here reflect the email
genuinely never stating that information (a grocery pickup confirmation predates
shipping/fulfillment, so there's no line-item breakdown or return window to state
yet), not a body-selection failure. This row does not count toward the confirmed
mechanism population.

## Confirmed-mechanism count

**1 of 158** baseline `order_confirmation` rows show the confirmed `orderNumber`-gate
mechanism (thin/boilerplate body pass 1 actually used + `orderNumber` sourced from
outside it + retry never fired). This is an exact count, not an estimate — every
pattern-matched row was individually verified against `extractionNotes`, not sampled.

---

## Confidence boundary

Step 4's spot-check covered **100% of the pattern-matched population (2 of 2)**, not a
sample of a larger matched set — so there is no extrapolation gap between "confirmed
spot-check ratio" and "raw pattern-match count" for *this* population. The confirmed
count (1) is exact given the current data, not a range.

The boundary that does exist is upstream of the spot-check: the pattern-match query
itself (Step 2's predicate) is only as good as its assumption that
`emailType = 'order_confirmation'` + the four-field-null shape captures every row this
mechanism could produce. Two things this census cannot rule out:
1. **A row where the mechanism fired but a body-content-dependent field happened to
   get populated anyway** (e.g. `orderDate` recovered by a different fallback path
   unrelated to this retry) would not match Step 2's all-null predicate and would be
   invisible to this count — the true mechanism-affected population could be
   *undercounted* if such a row exists elsewhere in the 158.
2. **`emailType` itself could be a casualty of the same class of failure** in a row
   that isn't `order_confirmation` at all (e.g. classified as `other` and junked before
   ever reaching this baseline) — this census only looked inside the 158-row baseline,
   not at rows excluded from it upstream.

Given the population is small (1 confirmed of 158, 0 silent), the practical
conclusion is the same either way: this is not evidence of a systemic, high-volume
failure today. But "1 of 158, exactly" should not be read as "1 of 158, provably
exhaustive of every way this mechanism could manifest" — it's exact for the predicate
as scoped, not a proof the predicate has zero blind spots.

## Scoping honesty

This census quantifies **only the confirmed `orderNumber`-gate mechanism** — the exact
code path traced in the 2026-09-06 Gap diagnostic (`extractEmailIdentity`'s retry
gates solely on `parsed.orderNumber == null`). The TASKS.md item that spawned this
census hypothesized a broader failure family — `retailer` or `emailType` supplied by a
non-body source (sender-domain fallback, the Haiku classifier) producing an analogous
"gate satisfied without the body ever mattering" effect. **That broader family is
theoretically similar but unconfirmed at the code level.** Nothing in
`extractEmailIdentity` or `runExtraction.ts` gates the retry on `retailer` or
`emailType` provenance — the retry's only gate is `orderNumber`. Confirming (or ruling
out) a retailer- or emailType-sourced variant would require a separate mechanism
trace through `lib/retailerFallback.ts` and `lib/classify.ts` — the same kind of
source-reading this diagnostic and the prior one did for `orderNumber` — not a broader
version of this SQL query. The `retailerSource` breakdown reported in Step 2 (both
matched rows are `body_extraction`) is supporting color for a future trace, not a
claim that a retailer-gated variant exists or has been ruled out.

**Not in scope here, per the Now item:** any fix, any code change to the retry
mechanism, reprocessing any email, backfill of any kind. Fix scoping — if warranted
given a confirmed count of 1 — is a separate follow-up item.

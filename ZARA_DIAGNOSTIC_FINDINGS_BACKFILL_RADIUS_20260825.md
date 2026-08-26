# Zara retailer fallback — backfill radius + instance pull (2026-08-25)

Follow-up to the same-day diagnostic (commit `0f8a94f`,
`ZARA_DIAGNOSTIC_FINDINGS_20260825.md`). Read-only — DB reads (Prisma
`findMany`/`findUnique`) and code reads only. 0 billed Anthropic calls.
No fix proposed or applied; no write to `Email.retailer`/`Order.retailer`.
Source: `scripts/pm-diag-zara-backfill-radius-20260825.ts`.

## Headline finding, up front

**Only 3 of the 8 rows are actually retailer emails. The other 5 are
carrier tracking notifications (2 FedEx, 3 USPS) with no retailer signal
in the sender at all** — `fromName` on those rows is `"FedEx Delivery
Manager"` / `"USPS Tracking"`, and `extractionNotes` on every one of them
says explicitly that the body identifies a carrier or logistics center,
not a retailer, and that no retailer can be determined. A naive
fromName-first fallback would confidently mislabel these five rows as
sold by "FedEx" or "USPS" — worse than the current "Unknown retailer,"
because it's a specific, wrong, confidently-displayed answer instead of an
honest null. This is not a corner case to design around later; it's the
majority (5/8) of the population this pass was asked to look at, so any
fallback design has to gate on "is this sender even a retailer" before
applying fromName/domain derivation — a carrier/logistics exclusion list
(same shape as the existing `FOOD_GROCERY_SENDER_DOMAINS` pattern in
`lib/foodGroceryExclusion.ts`) is a likely prerequisite, not a nice-to-have.

## Question 1 — instance pull

### 1a. The 8 commerce-typed Email rows with `retailer IS NULL`

| Email id | emailType | receivedAt | fromEmail / fromName | subject | orderId | orderNumber | needsReview / junkedAt | proposed fallback |
|---|---|---|---|---|---|---|---|---|
| `cmry6bkma0001la04eg6qeb40` | shipping_confirmation | 2026-07-23 | `TrackingUpdates@fedex.com` / "FedEx Delivery Manager" | "Your shipment is on the way 874801419836" | null (unlinked) | null | true / null | **"FedEx Delivery Manager" (WRONG — carrier, not retailer)** |
| `cms4ckgvu0001jv04dusukzsr` | shipping_confirmation | 2026-07-28 | `TrackingUpdates@fedex.com` / "FedEx Delivery Manager" | "Your shipment is scheduled for delivery tomorrow 874801419836" | null | null | true / null | **"FedEx Delivery Manager" (WRONG)** |
| `cms959nn00002kz04tx5r7r9p` | delivery | 2026-07-31 | `auto-reply@tracking.usps.com` / "USPS Tracking" | "USPS® Expected Delivery on Friday, July 31..." | null | null | true / null | **"USPS Tracking" (WRONG)** |
| `cmsdpc4ms0003l904w5qyfdma` | shipping_confirmation | 2026-08-03 | `auto-reply@tracking.usps.com` / "USPS Tracking" | "USPS® Expected Delivery on Tuesday, August 4..." | null | null | true / null | **"USPS Tracking" (WRONG)** |
| `cmseusp700001kt04dp107vbd` | delivery | 2026-08-04 | `auto-reply@tracking.usps.com` / "USPS Tracking" | "USPS® Expected Delivery on Tuesday, August 4..." | null | null | true / null | **"USPS Tracking" (WRONG)** |
| `cmsyjhrcw0001jm04stofqk35` | shipping_confirmation | 2026-08-18 | `noreply@zara.com` / "Zara" | "Your order has left the warehouse" | null | `54421192781` | true / null | "Zara" (domain-derived, correct — fromName also happens to say "Zara" here) |
| `cmt3kvyt60001jy045dr1rh64` | shipping_confirmation | 2026-08-21 | `noreply@zara.com` / "Zara" | "Your order is on its way" | null | `54421192781` | true / null | "Zara" (correct) |
| `cmt4ufiua0001jr04p564ts47` | delivery | 2026-08-22 | `noreply@zara.com` / "Zara" | "Your order was delivered" | null | `54421192781` | true / null | "Zara" (correct) |

**Grouped by family:** `zara.com` ×3 (Inditex family — massimodutti.com,
pullandbear.com, bershka.com, stradivarius.com, oysho.com all present in
domain list but 0 live rows today), `fedex.com` ×2, `tracking.usps.com`
×3. The generalizes-beyond-Zara check comes back **mixed**: the fallback
mechanism generalizes fine to any brand-direct sender, but the live
population is dominated by carrier notifications where generalizing the
mechanism naively would generalize the bug, not the fix.

All 8 are unlinked (`orderId: null`) and currently visible in the
needs-review bucket (`needsReview: true`, `junkedAt: null` on every row —
none archived).

### 1b. Order rows with `retailer IS NULL`

**Zero.** No `Order` row currently has a null `retailer`. The entire
null-retailer population lives on unlinked `Email` orphans, not on any
already-linked Order a user can see on their dashboard today. Practical
consequence: **this bug does not currently show "Unknown retailer" on any
Order card** — its only live render surfaces are the needs-review bucket
(`app/NeedsReviewRow.tsx:64`, reading `email.retailer` via
`emailReviewRow()`) and the weekly-coverage digest
(`app/api/cron/weekly-coverage/route.ts:196`, `items.push({ retailer:
email.retailer, ... })`). This narrows where a fix needs to land and
means the `Order.retailer` backfill side of the original question is
currently moot for the live population — there's nothing to backfill
there today (though the design should still decide what happens going
forward, since `Order.retailer` could go null again on some future
orphan-then-late-link path).

## Question 2 — backfill radius

### 2a. Downstream read sites (`lib/`, `app/` — live code; `scripts/*`
excluded as one-off historical diagnostics/backfills already run, not
part of the live pipeline)

**Sites where a null→value transition changes behavior, not just display:**

- **`lib/needsReviewRows.ts:78`** — `detectEmailReviewReason()`:
  `if (... PURCHASE_SIDE_EMAIL_TYPES.has(email.emailType) &&
  (email.retailer || email.orderNumber)) return "real_purchase_no_record"`.
  This is an **OR**, and it's a **routing condition**, not just a display
  read. For the 3 Zara rows, `orderNumber` is already non-null, so the OR
  is already true — backfilling `retailer` changes only the displayed
  name, not the branch. **For the 5 carrier rows, `orderNumber` is null
  too** — today they correctly fall through to `"no_extraction_signal"`
  (branch 4, the 2-control degrade row, canonical "We couldn't extract any
  details" sentence, per `NEEDS_REVIEW_ROUTING_DESIGN.md` / Session 2).
  **If a naive fallback backfilled `retailer` to "FedEx Delivery Manager"
  or "USPS Tracking" on these 5, the OR flips true and they'd reroute to
  `"real_purchase_no_record"` (branch 3) — a 3-control row whose primary
  action is "Start a new order."** That's actively wrong: it would prompt
  the user to create an order record for a carrier tracking email that
  isn't an order at all. This is the single most consequential finding in
  this pass — `retailer` on an Email row is not a pure display field, it's
  also a routing input for the just-shipped (2026-08-25) needs-review tree,
  and any backfill design has to treat it as such.
- **`lib/linkOrder.ts:794`** — `linkEmailToOrder`'s early-return gate:
  `if (!email.retailer || ...) { needsReview: true; return; }`. This is
  the ingestion-time function that produced these orphans in the first
  place. **Confirmed by code-reading (not re-run here): this function is
  only ever called from the inbound-ingestion path** —
  `recomputeOrderStatus`/`recomputeDisplayStatus`/`classifyReturnPortalTrust`
  (lines 867, 870, 889) are only invoked from inside it, nowhere else in
  `lib/` or `app/`, and nothing schedules it to re-run over existing rows.
  **A direct `Email.retailer` UPDATE would NOT retroactively trigger
  order-matching, order-creation, or any of `linkEmailToOrder`'s side
  effects.** If the design wants backfilled rows to actually attempt
  linking (not just display better in the needs-review bucket), that
  requires deliberately re-invoking this function (or an equivalent), which
  is a materially bigger, side-effect-bearing operation — see 2c.
  Separately, `findMatchingOrder`/`findPrefixMatchOrder` (lines 412-476)
  query `where: { retailer: { equals: retailer, mode: "insensitive" } }` —
  since no live Order has `retailer: null` today (1b), this doesn't affect
  any existing Order's matchability, but it does mean a future incoming
  email from the same retailer would still create a brand-new Order rather
  than merging with these orphans, unless/until they're actually linked.
- **`lib/amazonBundle.ts:8` `isAmazonOrder()`** — read at render time in
  `app/(app)/page.tsx:134,138` (dashboard filtering) and
  `app/api/cron/route.ts:216` / `weekly-digest/route.ts:180` (reminder/
  digest exclusion), substring match (`.includes("amazon")`, case-
  insensitive). None of the 8 rows' proposed fallback values contain
  "amazon," so no live risk from this specific backfill — flagged as a
  general pattern risk for any future retailer whose derived name happens
  to contain that substring, not a concern for this population.
- **`lib/foodGroceryExclusion.ts:38` `isFoodGroceryRetailer()`** — exact-
  match only (`"Amazon Fresh"`/`"Whole Foods Market"`), and only read at
  ingestion inside `linkEmailToOrder` (2a above) — not render-time, not
  retriggered by a field update. No risk from this backfill.

**Sites that are pure display, no behavior change on null→value:**
`app/OrderCard.tsx`, `app/(app)/orders/[id]/page.tsx`,
`app/LinkToOrderPicker.tsx`, `app/admin/**`, `app/action/{archive,returned}/
page.tsx`, `app/api/cron/route.ts:79,109,257,269,272,288,297,348,357`,
`app/api/cron/weekly-digest/route.ts:44,75`,
`app/api/cron/weekly-coverage/route.ts:52,191,196`,
`lib/refundCheckin.ts:44,72,127,147` — all read `.retailer` to interpolate
into a string or pass through unchanged; none branch on nullness in a way
that changes which code path runs. `app/(app)/page.tsx:158-159`
(alphabetical sort by retailer name) is display-adjacent — null retailers
sort via `?? ""`, so a backfill would move affected rows within sort
order, cosmetic only.

### 2b. User-visible flap

- **Weekly-coverage digest**: yes, would look different next Friday if
  retailer resolves — but that's the intended fix outcome, not a
  consistency bug. Already-sent digest emails are static (they're sent
  content, not live-rendered), so no retroactive inconsistency is
  possible there — a past email simply reflects what was true when it was
  sent.
- **Dashboard**: no flap possible today, because 1b confirms zero live
  Order rows are affected — nothing on the dashboard changes.
- **Needs-review bucket**: real flap, already covered in 2a — the display
  text changes for all 8 rows if a naive fallback runs, and the **row's
  entire control set and primary action changes for the 5 carrier rows**
  if `retailer` is treated as a routing input the way it currently is
  wired. This is the finding this whole pass exists to surface: it's not
  cosmetic for those 5.
- **No archived/dismissed rows resurface**: confirmed — all 8 have
  `junkedAt: null`, none are currently filtered out of view, so there's no
  "hidden row reappears" risk in the current population (though that's a
  property of *this* population, not a guarantee for whatever the null-
  retailer population looks like at the time a backfill actually runs).
- **Status recompute as a write-time side effect**: no — per 2a, a plain
  field UPDATE doesn't invoke `recomputeOrderStatus`/`recomputeDisplayStatus`
  at all (they're not triggered by anything watching this column), so a
  narrow "just set the field" backfill has zero status-recompute
  side effects. That only becomes a concern if the design chooses the
  broader "actually relink the orphans" version (2a, `linkEmailToOrder`
  path).

### 2c. Write mechanics

Two materially different operations, not one:

1. **Narrow: set `Email.retailer` (display-only) via direct
   `prisma.email.update`.** No other codified helper required. Zero side
   effects beyond the field itself — confirmed in 2a, nothing else reads
   this column at ingestion-adjacent decision points outside
   `linkEmailToOrder`, which isn't re-invoked by a plain update. Genuinely
   "read-only-adjacent" in cost terms: no `runExtraction`, no
   `lookupReturnPolicy`, no model call anywhere in this path — a backfill
   built this way really would be $0.
2. **Broad: also attempt linking these orphans into Orders.** Requires
   going through `linkEmailToOrder` (or duplicating its match/create logic
   deliberately), which carries `mergeEmailIntoOrder`/`createOrderFromEmail`,
   `recomputeOrderStatus`, `recomputeDisplayStatus`,
   `applyShippingTracking`, `applyReturnTracking`,
   `classifyReturnPortalTrust`, and `computeKeptStatusConflict` as real
   side effects on whatever Order it touches. **None of these call
   `lookupReturnPolicy` or `runExtraction` directly** (confirmed by reading
   `linkOrder.ts`'s full call chain from `linkEmailToOrder` down) — so even
   the broad version stays $0 in Anthropic cost — but it is a much larger
   blast radius than option 1 in terms of Order-state mutation, and it's
   the option that would actually resolve these 5 carrier rows' fate
   (right now they're correctly unlinkable — no retailer, no order number,
   nothing to link to — and backfilling retailer alone doesn't change
   that, since they'd still lack an order number to match/create against
   even after option 1).

### 2d. Rollback

**No existing mechanism.** There is no `retailerSource` (or similarly-
named) column recording provenance — `Email`'s schema (confirmed by
listing every field, `prisma/schema.prisma:92-190`) has nothing
comparable to `policySource`/`deadlineIsEstimated` for the retailer field.
If a backfill mislabels rows (the FedEx/USPS case above is exactly this
scenario, would it run naively), there is no "reset retailer to null where
source = sender_fallback" query available — recovery would require either
(a) the backfill script itself logging which row IDs it touched and what
it set, kept as a durable artifact the way the paper-trail scripts already
do, so a revert script could target exactly those IDs, or (b) adding a
provenance column before running anything, mirroring the `policySource`
pattern already established in this schema. Given finding 2a/2b above,
(a) or (b) isn't optional hygiene here — the carrier-row risk makes some
rollback path a hard prerequisite, not a nice-to-have.

## Close-out

Committed to `main`: `scripts/pm-diag-zara-backfill-radius-20260825.ts` +
this file. No app code changed, nothing deployed, nothing to verify live.
0 billed Anthropic API calls (script uses only
`prisma.*.findMany`/`findUnique` and `decryptEmailContent`; no
`runExtraction`/`extractEmail`/model call anywhere in the path — confirmed
by inspection of both the script and, for 2c, the full `linkOrder.ts` call
chain it reasons about). No fix applied, no design proposed. Feeds the
same pending `ZARA_RETAILER_FALLBACK_DESIGN.md`, which now has to reckon
with: a carrier/logistics exclusion gate as a likely prerequisite, the
retailer-as-routing-input coupling in `needsReviewRows.ts`, and a
provenance/rollback column as a probable co-requisite rather than a
follow-up.

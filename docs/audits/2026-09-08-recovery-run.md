# Real recovery run — 106 eligible self_outbound_loop discards

**Date:** 2026-09-08. **TASKS.md 🔴 Now item:** "Real recovery of the 106
eligible self_outbound_loop discards from `docs/audits/2026-09-07-recovery-
dryrun.md`." Owner-approved for the full 106 after a pre-flight checkpoint
(row/cost/write counts reported, explicit "go" received).

**Method:** real ingestion for all 106 messageIds accounted for by the dry-run
(105 in `DryRunCache` + the 1 `ERROR` row whose cache write had failed
mid-run). Real `prisma.email.create()`, real field writes from
`finalizeExtraction`, real `linkEmailToOrder()` — merge/create decision plus
the full cascade (`applyFallbackOrderDate`, `recomputeOrderStatus`,
`applyShippingTracking`/`applyReturnTracking`, `recomputeDisplayStatus`). No
`dryRunSink`, no simulation anywhere in this run. Classify/extract served
from `DryRunCache` wherever present; only genuine cache misses (1, expected)
hit a real Haiku/Sonnet call for those two stages. `policy_lookup` is never
cached and ran for real on every row that needed it.

Code: new script `scripts/audits/2026-09-08-recovery-run.ts`. The dry-run
driver (`scripts/audits/2026-09-07-recovery-dryrun-driver.ts`) was not
modified — this is a separate script with its own real-write path, per
scope.

**Pre-flight scope assertion, confirmed before any write:** `DryRunCache`
held exactly 105 rows; union with the ERROR row (`641077e7…`) = 106; zero of
the 106 already existed in `Email`. Verified with a read-only check before
building the script further.

**Run reliability:** zero crashes, zero connection-drop retries needed this
time (the two resilience fixes carried over from the dry-run driver —
per-row try/catch including the user lookup, and incremental JSONL writes —
were in place from the start, but weren't exercised by an actual Neon drop
during this particular run).

## Summary (same shape as the dry-run report, for direct comparison)

- **Total rows processed:** 106
- **Classified commerce:** 65 · **non-commerce:** 41 (dry-run predicted 64/41
  — the +1 commerce is the ERROR row, freshly classified for real; see below)
- **Created a new Order:** 12 (dry-run predicted 20)
- **Merged into an existing Order:** 16 (dry-run predicted 8)
- **Orphaned, no link (commerce):** 37
- **Non-commerce, discarded:** 41 (each a real `DiscardLog` row, reason
  `non_commerce` — verified: exactly 41 new rows in the last 2 hours)
- **Row-level errors:** 0

## The most significant divergence from the dry-run: 8 rows flipped NEW_ORDER → MERGE

This is expected, mechanical, and not a bug — flagging it prominently because
it's the single biggest number that moved. The dry-run evaluated every row in
isolation against a **frozen, pre-run snapshot** of `Order` state — it had no
way to know that another row *in the same batch* would create the order a
later row needed to merge into. This real run processes rows **sequentially
and for real**, so once an earlier row created an order (e.g., the Amazon
order-confirmation for order `114-0761265-1327446`), a later row in the same
run (its shipping-confirmation email) correctly found and merged into that
just-created order instead of starting a second one.

All 8 flips are shipping/delivery/tracking-update emails merging into an
order their own order-confirmation (processed earlier in this same run)
had just created:

| messageId | sender | subject | merged into |
|---|---|---|---|
| `6ea95b3d…` | shipment-tracking@amazon.com | Shipped: "Maruman Mnemosyne Spiral..." | Amazon #114-0761265-1327446 |
| `6a606aff…` | ebay@ebay.com | 🚚 Order update: Northland Stainless "Roya... | eBay #11-15123-97092 |
| `00781751…` | shipment-tracking@amazon.com | Shipped: "Divvsck Waterproof Knee..." | Amazon #114-8641341-8587466 |
| `3d340c16…` | shipment-tracking@amazon.com | Shipped: "Hydro Flask Travel Tumbler..." | Amazon #114-0153602-2860224 |
| `7f52daa0…` | adidas@us-info.adidas.com | Your adidas order update | adidas #AD962505056 |
| `bdd0e2c6…` | adidas@us-info.adidas.com | Your order is on its way | adidas #AD962505056 |
| `a526d450…` | shipment-tracking@amazon.com | Shipped: 1 Kitchen item | Amazon #111-5093011-9850626 |
| `03e026ea…` | CustomerService@notify.bloomingdales.com | Your order has shipped! #781160797 | Bloomingdale's #781160797 |

This is a **better** outcome than the dry-run predicted, not a worse one —
these 8 orders now correctly have their shipping/tracking data attached
instead of the dry-run's (necessarily pessimistic, isolation-based) guess
that they'd become 8 separate, incomplete orders.

## One classifier/extraction disagreement worth noting (the former ERROR row)

`641077e7-56c5-4523-bf29-f90259a840dd` (Ralph Lauren, "Shop Our Labor Day
Event Now") — its `DryRunCache` write failed mid-run during the dry-run, so
it got a fresh, real classify+extract here. **Haiku classified it as
commerce**; **Sonnet's extraction then resolved `emailType: "other"` with no
retailer or order number** — i.e., the two stages disagreed on how
transactional this email actually is, and the more detailed extraction pass
won out, correctly landing it as an orphan (`NO_LINK`) rather than creating
spurious order data. Not an error, not a bug — the pipeline's own two-stage
design working as intended on a genuinely ambiguous email.

## A known, already-flagged issue surfacing here: Crate & Barrel

One of the 12 new orders is **Crate & Barrel #359173100**, created from
"Item(s) from Order 359173100 are Ready for Pickup" alone — **with no
`order_confirmation` email on file**, because that email
("Your order confirmation is 359173100") was misclassified as `non_commerce`
back in the **founder pilot**, not in this run. This is the exact "Crate &
Barrel classifier false-negative" already filed as a separate, explicitly
out-of-scope follow-up in both the dry-run report and this session's task
brief — surfacing here as an anticipated consequence, not a new finding.

## Full merge detail — all 16 MERGE rows, field-level BEFORE/AFTER

One overwrite worth a second look: `ee00773d…` (Margaux, "Your order has
arrived") overwrote `deliveredAt` from a precise timestamp
(`2026-09-06T21:51:00Z`, set moments earlier in this same run by the
`0627745e…` "It's delivery time!" email) down to a **less precise**
date-only value (`2026-09-06T00:00:00Z`) extracted from its own body. Both
values are real, extracted data — this is `mergeEmailIntoOrder`'s ordinary
"newer non-null wins" semantics doing exactly what it always does, not a
bug introduced by recovery, but a real instance of precision being lost on
merge order, worth knowing about.


**`c6628534-1791-48be-9512-2e661f9b7d85`** — shipment-tracking@amazon.com — "Shipped: 1 Skincare item"
- Target: Amazon #112-0108462-4820222 (`cmtm4xh2z0003l2046hg1lmvt`)
  - `returnDeadline`: `None` -> `2026-10-03T23:06:59.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`6ea95b3d-2ed6-42a3-867c-456e7991e525`** — shipment-tracking@amazon.com — "Shipped: "Maruman Mnemosyne Spiral...""
- Target: Amazon #114-0761265-1327446 (`cmts5gjeh0003w9hvng00a8ex`)
  - `returnDeadline`: `None` -> `2026-10-04T00:43:51.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`4737e7f5-728d-4f05-bd25-8361129fb96f`** — order-update@amazon.com — "Cleared Customs: "Small Pilates Ball 9 Inch...""
- Target: Amazon #112-7731463-7936228 (`cmtk6p0ws0003ju04sxgrnmv9`)
  - `orderTotal`: `2.42` -> `2.33` [OVERWRITE]
  - `lineItems`: 0 item(s) -> 1 item(s) [APPEND]

**`65ad6731-2892-4e8a-8366-945008c1d48c`** — order-update@amazon.com — "Delivery update: "Jastore Girls Layered Tulle..." and 1 more item"
- Target: Amazon Haul #112-9226700-5012223 (`cmtimlw450003l304ppjlai64`)
  - `deliveredAt`: `None` -> `2026-09-05T16:08:43.000Z` [FILL_NULL]
  - `orderTotal`: `36.02` -> `21.98` [OVERWRITE]
  - `lineItems`: 0 item(s) -> 2 item(s) [APPEND]

**`6a606aff-49f6-4af1-97d3-97cf49b13a00`** — ebay@ebay.com — "🚚 Order update: Northland Stainless “Roya..."
- Target: eBay #11-15123-97092 (`cmts5rajz0016w9hvaqbqvlkr`)
  - `returnDeadline`: `None` -> `2026-10-10T04:29:38.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`e4c7c58f-500d-42a9-8bd6-42fb1767fc3c`** — CustomerService@notify.bloomingdales.com — "Thanks for your order! #781187611"
- Target: Bloomingdale's #781187611 (`cmtrpvmcx0003l7045cbhmsgx`)
  - `orderDate`: `2026-09-07T20:52:13.000Z` -> `2026-09-06T03:13:22.000Z` [OVERWRITE]
  - `orderDateSource`: `fallback` -> `extracted` [OVERWRITE]
  - `orderDateEstimated`: `True` -> `False` [OVERWRITE]
  - `deadlineIsEstimated`: `True` -> `False` [OVERWRITE]

**`00781751-71a2-4b32-a766-7f5ce63f5a8d`** — shipment-tracking@amazon.com — "Shipped: "Divvsck Waterproof Knee...""
- Target: Amazon #114-8641341-8587466 (`cmts5rvfx001uw9hvik94wru6`)
  - `returnDeadline`: `None` -> `2026-10-05T16:26:53.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`3d340c16-8dad-4145-8e47-ccb6b917a223`** — shipment-tracking@amazon.com — "Shipped: "Hydro Flask Travel Tumbler...""
- Target: Amazon #114-0153602-2860224 (`cmts5t5n2002nw9hv72y44qtk`)
  - `returnDeadline`: `None` -> `2026-10-05T22:10:18.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`7f52daa0-b88e-44e0-bb22-98b47104483a`** — adidas@us-info.adidas.com — "Your adidas order update"
- Target: adidas #AD962505056 (`cmts5sz3p002dw9hvg6u52y2r`)
  - `deliveryDate`: `None` -> `2026-09-14T00:00:00.000Z` [FILL_NULL]
  - `estimatedDeliveryDate`: `None` -> `2026-09-14T00:00:00.000Z` [FILL_NULL]
  - `returnDeadline`: `2025-09-17T00:00:00.000Z` -> `2026-09-21T00:00:00.000Z` [OVERWRITE]
  - `orderCurrency`: `None` -> `USD` [FILL_NULL]

**`0627745e-c5df-4c75-89e8-c776773d4449`** — news@margauxny.com — "It's delivery time!"
- Target: Margaux #593636 (`cmteyx9mg0003l904xnx0wnx8`)
  - `deliveredAt`: `None` -> `2026-09-06T21:51:00.000Z` [FILL_NULL]

**`8c874a7c-198d-4f25-ab67-61d429771cf4`** — orders@oe.target.com — "Get ready for something special! Items from order #912003709357307 are about to "
- Target: Target #912003709357307 (`cmtrjpljv0003l804oig6rqo4`)
  - `orderTotal`: `24.3` -> `26.92` [OVERWRITE]
  - `returnPortalUrl`: `https://click.oe.target.com/?qs=ABB7InYiOjEsImQiOjQ5OTJ9AAcAAAAABkTRi8McoXtH_hSUmwcIOI40YtsQWdgKjLlcPIqsjFCrFRaZ4xyzclIAyAho1BhePUPd68x7K9VhaB4mylSpNPF48FyYtyRHe3uPhACtGg` -> `https://click.oe.target.com/?qs=ABB7InYiOjEsImQiOjQ5OTJ9AAcAAAAABkB-8b2eY3boro4ru0KKkv9aLMaULgbwED_O_B8nHqD2BqaXrle8atNXNeNkbdI6i16gE2QXDkAA7o-WCMKlgU4g90s68z2r-vpCgyMxPg` [OVERWRITE]

**`bdd0e2c6-4920-4429-bf4b-6f115d18444e`** — adidas@us-info.adidas.com — "Your order is on its way"
- Target: adidas #AD962505056 (`cmts5sz3p002dw9hvg6u52y2r`)
  - No field changes.

**`ee00773d-0d3f-42d3-9190-2b7ba79f0710`** — news@margauxny.com — "Your order has arrived"
- Target: Margaux #593636 (`cmteyx9mg0003l904xnx0wnx8`)
  - `deliveryDate`: `None` -> `2026-09-06T00:00:00.000Z` [FILL_NULL]
  - `deliveredAt`: `2026-09-06T21:51:00.000Z` -> `2026-09-06T00:00:00.000Z` [OVERWRITE]
  - `returnDeadline`: `2026-09-17T00:00:00.000Z` -> `2026-09-20T00:00:00.000Z` [OVERWRITE]
  - `deadlineIsEstimated`: `True` -> `False` [OVERWRITE]
  - `policySource`: `web_lookup` -> `stated_in_email` [OVERWRITE]

**`a526d450-c48b-4e74-8a62-2cd6590752ba`** — shipment-tracking@amazon.com — "Shipped: 1 Kitchen item"
- Target: Amazon #111-5093011-9850626 (`cmts5uqcq0040w9hvuuas4hpm`)
  - `returnDeadline`: `None` -> `2026-10-07T04:55:24.000Z` [FILL_NULL]
  - `deadlineIsEstimated`: `False` -> `True` [OVERWRITE]

**`03e026ea-44e8-4620-8eab-805197d7e63b`** — CustomerService@notify.bloomingdales.com — "Your order has shipped! #781160797"
- Target: Bloomingdale's #781160797 (`cmts5rxus001yw9hv736f6gqj`)
  - No field changes.

**`0d48f36c-e293-472f-916f-ebefa7b7dfb6`** — gap@gap.narvar.com — "Your order is arriving soon."
- Target: GAP #1RYJR48 (`cmtkeeq7e0003le04eqt79jcz`)
  - `deliveryDate`: `None` -> `2026-09-08T00:00:00.000Z` [FILL_NULL]
  - `estimatedDeliveryDate`: `None` -> `2026-09-08T00:00:00.000Z` [FILL_NULL]
  - `returnDeadline`: `2026-10-07T17:56:08.000Z` -> `2026-10-08T00:00:00.000Z` [OVERWRITE]

## All 12 new Orders created

| Order id | Retailer | Order # | orderTotal | Source email |
|---|---|---|---|---|
| `cmts5gjeh0003w9hvng00a8ex` | Amazon | 114-0761265-1327446 | 13.42 | "Ordered: \"Maruman Mnemosyne Spiral...\"" |
| `cmts5in3v0011w9hvi0gf2au4` | Shutterfly | 5011207321227 | 4.68 | "Your Shutterfly order is ready for pick up!" |
| `cmts5rajz0016w9hvaqbqvlkr` | eBay | 11-15123-97092 | 13.74 | "Mckenna, your order is confirmed" |
| `cmts5rvfx001uw9hvik94wru6` | Amazon | 114-8641341-8587466 | 18.58 | "Ordered: \"Divvsck Waterproof Knee...\"" |
| `cmts5rxus001yw9hv736f6gqj` | Bloomingdale's | 781160797 | (null) | "Thanks for your order! #781160797" |
| `cmts5sz3p002dw9hvg6u52y2r` | adidas | AD962505056 | 124.48 | "Thanks for your order, Alexandra" |
| `cmts5t2ef002jw9hvk7miq8jx` | Amazon | 114-2886356-4485061 | 25.72 | "Ordered: \"Sensodyne Pronamel Gentle...\"" |
| `cmts5t5n2002nw9hv72y44qtk` | Amazon | 114-0153602-2860224 | 27.98 | "Ordered: \"Hydro Flask Travel Tumbler...\"" |
| `cmts5u17c002tw9hvxik7e6y1` | Dermstore | 780517802 | 121.75 | "We've received your order" |
| `cmts5uqcq0040w9hvuuas4hpm` | Amazon | 111-5093011-9850626 | 32.76 | "Ordered: 1 Kitchen item" |
| `cmts5yr4r004gw9hv8quzq9uz` | NET-A-PORTER | 0509ZLVGR2638M | (null) | "Your NET-A-PORTER order is on its way..." |
| `cmts60jr9005cw9hv2o696nqh` | Crate & Barrel | 359173100 | (null) | "Item(s) from Order 359173100 are Ready for Pickup" (see Crate & Barrel note above) |

## Actual billed API calls — exact counts

| Call site | Count |
|---|---|
| `commerce_classifier` (Haiku) | **1** |
| `email_extraction` (Sonnet, incl. retry) | **1** |
| `email_extraction_retry` | **0** |
| `policy_lookup` (web search) | **7** |
| **Total** | **9** |

Pre-flight estimate was ~15-16 (with `policy_lookup` estimated at ~14, matched
to the dry-run's own observed count). Actual `policy_lookup` count (7) came
in lower than estimated for the same reason the NEW_ORDER→MERGE flips
happened: this run's sequential, real order-creation meant several rows that
would have independently triggered a policy lookup in isolation instead found
an already-resolved `returnWindowDays` on an order a slightly-earlier row in
this same run had just created or merged into.

## Recovery-run failures

**None.** Zero rows ended in `ERROR`. Zero rows hit `UNEXPECTED_SELF_OUTBOUND`
(no cached classify/extract or matching decision differed from what the
dry-run recorded for any of the 8 pre-approved merge candidates — all 8
proceeded exactly as previewed, plus the 8 additional flips explained above,
which are a consequence of sequential ordering, not a classification
change).

## Committed / pushed / deployed

- **Committed and pushed:** yes — the new script
  (`scripts/audits/2026-09-08-recovery-run.ts`) and this doc.
- **Deployed:** not applicable. This is a data-only recovery run — no
  application code changed (the dry-run driver, the guard, and
  `lib/linkOrder.ts` are all untouched this session). There is nothing for
  Vercel to build or deploy; the effect of this session is entirely rows in
  the production database, written by running the script locally against
  the single shared database (per this repo's one-database setup).

## Full row-level table (106 rows)

| # | messageId | userId | sender / subject | commerce | emailType | orderNumber | retailer | outcome | orderId (after) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `a018552a` | `cmqvuw58` | amazon.com: Ordered: "Maruman Mnemosyne Spiral..." | commerce | order_confirmation | 114-0761265-1327446 | Amazon | NEW_ORDER | cmts5gjeh000 |
| 2 | `fe0e79d5` | `cmqx4cy1` | email.eberjey.com: NEW PJ PRINT | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 3 | `c6628534` | `cmrp9zgm` | amazon.com: Shipped: 1 Skincare item | commerce | shipping_confirmation | 112-0108462-4820222 | Amazon | MERGE | cmtm4xh2z000 |
| 4 | `a0f1d21a` | `cmqx4cy1` | laundrysauce.com: Labor Day Sale Starts Now | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 5 | `52fe7307` | `cmqx4cy1` | thirdlove.com: Still on: Up to 30% off sitewide. | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 6 | `89f36389` | `cmqx4cy1` | mail.ralphlauren.com: For a Limited Time—Enjoy 30% Off​ at Our Labor Day Event | commerce | other |  |  | NO_LINK |  |
| 7 | `26c8055d` | `cmqx4cy1` | ubeauty.com: Final Call: The OOO Set Is Almost Gone | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 8 | `1643273b` | `cmqx4cy1` | jennikayne.com: The Float Top Is Trending Now | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 9 | `113c9407` | `cmqx4cy1` | forrowan.com: Final Few | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 10 | `34cfc972` | `cmqx4cy1` | skatie.com: 30% off for the long weekend vibe! xo | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 11 | `69349ab2` | `cmqx4cy1` | mail.ralphlauren.com: Suiting Staples | commerce | other |  |  | NO_LINK |  |
| 12 | `1bbe6809` | `cmrp9zgm` | ruggable.com: Refresh any room with up to 40% off | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 13 | `6ea95b3d` | `cmqvuw58` | amazon.com: Shipped: "Maruman Mnemosyne Spiral..." | commerce | shipping_confirmation | 114-0761265-1327446 | Amazon | MERGE | cmts5gjeh000 |
| 14 | `053a53fc` | `cmqu524v` | email.bloomingdales.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |
| 15 | `1c80b1e3` | `cmqx4cy1` | paws.chewy.com: Scrub. Rinse. Snuggle. | commerce | other |  | Chewy | NO_LINK |  |
| 16 | `0e49ec8d` | `cmqu524v` | email.bloomingdales.com: Save 20-25% on denim | commerce | other |  |  | NO_LINK |  |
| 17 | `f5fb632b` | `cmqx4cy1` | jonesroadbeauty.com: A Note From Bobbi for Labor Day | commerce | other |  |  | NO_LINK |  |
| 18 | `d8f1743c` | `cmqx4cy1` | larroude.com: The Labor Day Rush just got better | commerce | other |  |  | NO_LINK |  |
| 19 | `50d3fd25` | `cmqx4cy1` | loyallist.bloomingdales.com: Save 20-25% on denim | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 20 | `c877f9ed` | `cmqx4cy1` | jennikayne.com: It’s Back: Free Furniture Delivery | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 21 | `4a9a7aa0` | `cmqx4cy1` | ubeauty.com: Exclusive Offer: 20% Off + Free Shipping | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 22 | `475c165c` | `cmqx4cy1` | mail.ralphlauren.com: The Long Weekend Starts Here | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 23 | `5fa82d64` | `cmqtng57` | cs.shutterfly.com: Your Shutterfly order is ready for pick up! | commerce | delivery | 5011207321227 | Shutterfly | NEW_ORDER | cmts5in3v001 |
| 24 | `39eafc8e` | `cmqx4cy1` | email.eberjey.com: Ready To Be Yours | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 25 | `f3410ac9` | `cmqtng57` | ebay.com: Mckenna, your order is confirmed | commerce | order_confirmation | 11-15123-97092 | eBay | NEW_ORDER | cmts5rajz001 |
| 26 | `7e49fac2` | `cmqx4cy1` | summersalt.com: You really, really like this suit | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 27 | `9a1790bb` | `cmqx4cy1` | forrowan.com: Love is the Road | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 28 | `630687bd` | `cmqx4cy1` | mackweldon.com: Before it’s gone. | commerce | other |  |  | NO_LINK |  |
| 29 | `2582b819` | `cmqu524v` | email.bloomingdales.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |
| 30 | `6730eaf8` | `cmqx4cy1` | laundrysauce.com: 20% Off Subscriptions, 10% Off Sitewide. | commerce | other |  |  | NO_LINK |  |
| 31 | `e4868109` | `cmqx4cy1` | thirdlove.com: The Fall Reset Sale everyone’s talking about. | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 32 | `150efeb7` | `cmqx4cy1` | mail.ralphlauren.com: The Labor Day Event—Enjoy an Extra 30% Off​ | commerce | other |  |  | NO_LINK |  |
| 33 | `4737e7f5` | `cmrp9zgm` | amazon.com: Cleared Customs: "Small Pilates Ball 9 Inch..." | commerce | shipping_confirmation | 112-7731463-7936228 | Amazon | MERGE | cmtk6p0ws000 |
| 34 | `f7bcc2a4` | `cmrp9zgm` | rugsusa.com: Buy one rug, get one 50% off | commerce | other |  |  | NO_LINK |  |
| 35 | `484106de` | `cmqx4cy1` | jennikayne.com: Our Sweater Sizes, Simplified | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 36 | `261e9bde` | `cmqx4cy1` | larroude.com: Walk like a Boss | commerce | other |  |  | NO_LINK |  |
| 37 | `65ad6731` | `cmrp9zgm` | amazon.com: Delivery update: "Jastore Girls Layered Tulle..." and 1 more item | commerce | delivery | 112-9226700-5012223 | Amazon | MERGE | cmtimlw45000 |
| 38 | `8add2f0b` | `cmqvuw58` | amazon.com: Ordered: "Divvsck Waterproof Knee..." | commerce | order_confirmation | 114-8641341-8587466 | Amazon | NEW_ORDER | cmts5rvfx001 |
| 39 | `f45cfa38` | `cmqx4cy1` | notify.bloomingdales.com: Thanks for your order! #781160797 | commerce | order_confirmation | 781160797 | Bloomingdale's | NEW_ORDER | cmts5rxus001 |
| 40 | `20a23992` | `cmqu524v` | email.bloomingdales.com: Almost sold out | commerce | other |  |  | NO_LINK |  |
| 41 | `a324e8dc` | `cmqu524v` | email.bloomingdales.com: Add these new markdowns to bag now | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 42 | `32111880` | `cmrp9zgm` | em.target.com: Don't miss your new Target Circle Bonus! 🎉 | commerce | other |  |  | NO_LINK |  |
| 43 | `6a606aff` | `cmqtng57` | ebay.com: 🚚 Order update: Northland Stainless “Roya... | commerce | shipping_confirmation | 11-15123-97092 | eBay | MERGE | cmts5rajz001 |
| 44 | `c9bc7113` | `cmrp9zgm` | em.target.com: Hello! An item is still in your cart. | commerce | other |  |  | NO_LINK |  |
| 45 | `fe6d105d` | `cmqx4cy1` | loyallist.bloomingdales.com: Goals: A perfectly organized home | commerce | other |  | Bloomingdale's | NO_LINK |  |
| 46 | `773f1e7e` | `cmqvuw58` | us-info.adidas.com: Thanks for your order, Alexandra | commerce | order_confirmation | AD962505056 | adidas | NEW_ORDER | cmts5sz3p002 |
| 47 | `8920d99c` | `cmqu524v` | email.bloomingdales.com: Save up to 70% online & in store | commerce | other |  |  | NO_LINK |  |
| 48 | `7902748a` | `cmqvuw58` | amazon.com: Ordered: "Sensodyne Pronamel Gentle..." | commerce | order_confirmation | 114-2886356-4485061 | Amazon | NEW_ORDER | cmts5t2ef002 |
| 49 | `822494bf` | `cmqvuw58` | amazon.com: Ordered: "Hydro Flask Travel Tumbler..." | commerce | order_confirmation | 114-0153602-2860224 | Amazon | NEW_ORDER | cmts5t5n2002 |
| 50 | `e4c7c58f` | `cmqx4cy1` | notify.bloomingdales.com: Thanks for your order! #781187611 | commerce | order_confirmation | 781187611 | Bloomingdale's | MERGE | cmtrpvmcx000 |
| 51 | `c79bc688` | `cmqx4cy1` | t.dermstore.com: We've received your order | commerce | order_confirmation | 780517802 | Dermstore | NEW_ORDER | cmts5u17c002 |
| 52 | `00781751` | `cmqvuw58` | amazon.com: Shipped: "Divvsck Waterproof Knee..." | commerce | shipping_confirmation | 114-8641341-8587466 | Amazon | MERGE | cmts5rvfx001 |
| 53 | `3d340c16` | `cmqvuw58` | amazon.com: Shipped: "Hydro Flask Travel Tumbler..." | commerce | shipping_confirmation | 114-0153602-2860224 | Amazon | MERGE | cmts5t5n2002 |
| 54 | `d27c29fb` | `cmqx4cy1` | summersalt.com: < 48 hours to go ⏰ | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 55 | `e3887ba9` | `cmqx4cy1` | email.informeddelivery.usps.com: Your Daily Digest for Sun, 9/6 is ready to view | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 56 | `f716720b` | `cmqx4cy1` | skatie.com: Yep, it's all on sale! (but not for much longer) | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 57 | `841d08eb` | `cmqx4cy1` | mail.ralphlauren.com: Long Weekend. Timeless Style. | commerce | other |  |  | NO_LINK |  |
| 58 | `916955af` | `cmqx4cy1` | ubeauty.com: 48 Hours Left: Claim Your Free Weekend Bag | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 59 | `4fcf266d` | `cmrp9zgm` | em.target.com: Your New Weekly Ad is here. | commerce | other |  |  | NO_LINK |  |
| 60 | `68f3c9cd` | `cmrp9zgm` | rugsusa.com: The Labor Day Event: BOGO 50% off | commerce | other |  |  | NO_LINK |  |
| 61 | `927db4d8` | `cmqx4cy1` | furyou.com: Your 20% Off Ends Tomorrow ⏰ | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 62 | `2bf06418` | `cmqu524v` | email.informeddelivery.usps.com: Your Daily Digest for Sun, 9/6 is ready to view | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 63 | `728fd04d` | `cmqx4cy1` | larroude.com: Shop by Category. Sale Edit. | commerce | other |  |  | NO_LINK |  |
| 64 | `7e719fbc` | `cmqx4cy1` | larroude.com: Shop by Category. Sale Edit. | commerce | other |  |  | NO_LINK |  |
| 65 | `e865571c` | `cmqx4cy1` | jennikayne.com: 3 New Shades, 1 Iconic Knit | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 66 | `2f222356` | `cmrp9zgm` | em.target.com: An item in your cart is on sale. Really. | commerce | other |  |  | NO_LINK |  |
| 67 | `bd05cff0` | `cmqx4cy1` | email.bloomingdales.com: Ends tomorrow! Take 25% off app purchases | commerce | other |  |  | NO_LINK |  |
| 68 | `d413d1be` | `cmqx4cy1` | skatie.com: what i'd actually buy from the sale | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 69 | `8ae33267` | `cmqx4cy1` | moderncitizen.com: Back at it 👩🏻‍💻 | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 70 | `7f52daa0` | `cmqvuw58` | us-info.adidas.com: Your adidas order update | commerce | shipping_confirmation | AD962505056 | adidas | MERGE | cmts5sz3p002 |
| 71 | `0627745e` | `cmqtng57` | margauxny.com: It's delivery time! | commerce | delivery | 593636 | Margaux | MERGE | cmteyx9mg000 |
| 72 | `5e9f52d4` | `cmqx4cy1` | larroude.com: Summer Isn’t Over Yet | commerce | other |  | Larroude | NO_LINK |  |
| 73 | `285115e1` | `cmqx4cy1` | loyallist.bloomingdales.com: The Labor Day Sale ends tomorrow! | commerce | other |  |  | NO_LINK |  |
| 74 | `8c874a7c` | `cmrp9zgm` | oe.target.com: Get ready for something special! Items from order #912003709357307 are about to  | commerce | shipping_confirmation | 912003709357307 | Target | MERGE | cmtrjpljv000 |
| 75 | `bdd0e2c6` | `cmqvuw58` | us-info.adidas.com: Your order is on its way | commerce | shipping_confirmation | AD962505056 | adidas | MERGE | cmts5sz3p002 |
| 76 | `7c91a9c3` | `cmqtng57` | amazon.com: Ordered: 1 Kitchen item | commerce | order_confirmation | 111-5093011-9850626 | Amazon | NEW_ORDER | cmts5uqcq004 |
| 77 | `76a10164` | `cmqx4cy1` | larroude.com: Up to 70% off + 10% off sitewide | commerce | other |  |  | NO_LINK |  |
| 78 | `ee00773d` | `cmqtng57` | margauxny.com: Your order has arrived | commerce | delivery | 593636 | Margaux | MERGE | cmteyx9mg000 |
| 79 | `10868102` | `cmqx4cy1` | summersalt.com: 30% OFF Sitewide ends in 3...2... | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 80 | `714ae5d9` | `cmqx4cy1` | s.factor75.com: Your Factor box is on its way! | commerce | delivery |  | Factor | NO_LINK |  |
| 81 | `a526d450` | `cmqtng57` | amazon.com: Shipped: 1 Kitchen item | commerce | shipping_confirmation | 111-5093011-9850626 | Amazon | MERGE | cmts5uqcq004 |
| 82 | `2ca59830` | `cmqx4cy1` | hillhousehome.com: LAST CHANCE! End of Summer Sale | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 83 | `3339b46f` | `cmqx4cy1` | forrowan.com: Two for You. One for One You Love. | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 84 | `852a7d36` | `cmqx4cy1` | email.eberjey.com: Sale Ends At Midnight | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 85 | `b766e198` | `cmqvuw58` | emails.net-a-porter.com: Your NET-A-PORTER order is on its way - order 0509ZLVGR2638M | commerce | shipping_confirmation | 0509ZLVGR2638M | NET-A-PORTER | NEW_ORDER | cmts5yr4r004 |
| 86 | `4542827b` | `cmqx4cy1` | skatie.com: 30% off ends tonight! | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 87 | `8e41cc1a` | `cmqx4cy1` | mail.ralphlauren.com: Ends Tomorrow: The Labor Day Event | commerce | other |  |  | NO_LINK |  |
| 88 | `e1a98626` | `cmqx4cy1` | paws.chewy.com: How to tell if your pup has fleas | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 89 | `95652a0d` | `cmqx4cy1` | ubeauty.com: Last Chance: 20% Off + Free Shipping | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 90 | `03e026ea` | `cmqx4cy1` | notify.bloomingdales.com: Your order has shipped! #781160797 | commerce | shipping_confirmation | 781160797 | Bloomingdale's | MERGE | cmts5rxus001 |
| 91 | `95cb73f5` | `cmqx4cy1` | jonesroadbeauty.com: LAST CALL: Labor Day Sale Ends Tonight | commerce | other |  |  | NO_LINK |  |
| 92 | `eb25d7e8` | `cmqx4cy1` | jennikayne.com: Today Only: Earn 2x Points | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 93 | `39c9c8fe` | `cmrp9zgm` | rugsusa.com: The Labor Day Sale ends tomorrow | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 94 | `ba471b45` | `cmrp9zgm` | linguafranca.nyc: Last Day To Shop Sale! | commerce | other |  |  | NO_LINK |  |
| 95 | `0d48f36c` | `cmqtng57` | gap.narvar.com: Your order is arriving soon. | commerce | shipping_confirmation | 1RYJR48 | Gap | MERGE | cmtkeeq7e000 |
| 96 | `1a9d9991` | `cmqu524v` | email.bloomingdales.com: Your exclusive 25% off ends soon! | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 97 | `fadaa4f9` | `cmqx4cy1` | mail.ralphlauren.com: Perfect Fall Pairings | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 98 | `7ea13606` | `cmrp9zgm` | rugsusa.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |
| 99 | `6ca7a014` | `cmqx4cy1` | mail.ralphlauren.com: Send Summer Off in Style | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 100 | `727941de` | `cmrp9zgm` | ruggable.com: Best deals on best sellers | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 101 | `98b3b424` | `cmqtng57` | m.shopifyemail.com: [TEST] Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |
| 102 | `47e9625d` | `cmqtng57` | m.shopifyemail.com: [TEST] Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |
| 103 | `9a9e1b27` | `cmqtng57` | g.shopifyemail.com: Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |
| 104 | `7a7f13e2` | `cmrp9zgm` | hillhousehome.com: LAST CHANCE! End of Summer Sale | non_commerce |  |  |  | NON_COMMERCE_DISCARDED |  |
| 105 | `b79ca34c` | `cmqtng57` | mail.crateandbarrel.com: Item(s) from Order 359173100 are Ready for Pickup | commerce | delivery | 359173100 | Crate & Barrel | NEW_ORDER | cmts60jr9005 |
| 106 | `641077e7` | `cmqx4cy1` | mail.ralphlauren.com: Shop Our Labor Day Event Now | commerce | other |  |  | NO_LINK |  |

## Follow-ups the owner decides

- All items explicitly out of scope for this session remain open, unchanged:
  `DiscardLog` messageId schema, Email state-change audit, cond2
  (`return_path_domain`) ungated check, delayed-notification-jobs audit,
  Shopbop ghost, Warby orderTotal extraction, Gap shipping UPS tracking,
  **Crate & Barrel classifier false-negative** (now with one more concrete
  instance — order `cmts60jr9005cw9hv2o696nqh` — worth including if that
  follow-up gets picked up), Shutterfly null-emailType row, `DryRunCache`
  cleanup lifecycle, 3-day outage post-mortem, alpha user notification.
- The `deliveredAt` precision-loss-on-merge pattern (`ee00773d…`, above) —
  whether this general "newer non-null wins regardless of precision" shape
  is worth its own follow-up, separate from the chronology-aware merge
  work already filed.
- Whether to hand-verify the 12 new orders and 16 merges against the app UI
  before considering this recovery batch fully done (matches this repo's
  "done means deployed/verified" convention for data changes with
  user-facing effect).

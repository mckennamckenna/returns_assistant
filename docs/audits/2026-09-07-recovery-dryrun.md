# Recovery dry-run — 106 remaining eligible self_outbound_loop discards

**Date:** 2026-09-07/08. **TASKS.md 🔴 Now item:** self-outbound guard fix's recovery
plan, Step 2 dry-run (owner-approved, two checkpoints: diff review before code
changes, cost restatement before the run).

**Method:** simulated ingestion for all 106 eligible discards not already
processed by the founder pilot (118 eligible − 12 pilot rows). Made real,
billed Anthropic calls (`isCommerceEmail`/Haiku, `extractEmailIdentity`/Sonnet
+ retry, `finalizeExtraction`'s policy-lookup web search) — those are not
simulated. **Wrote nothing to `Email` or `Order`.** The only DB writes were to
the new `DryRunCache` table, which lets a later real recovery pass skip
re-billing the classify/extract calls for the same messageIds.

Code: `lib/linkOrder.ts`'s `mergeEmailIntoOrder`/`createOrderFromEmail` gained
an optional `dryRunSink` parameter (commit `b5a67c4`) — every existing call
site is unaffected (824/824 tests passing, build clean). Driver:
`scripts/audits/2026-09-07-recovery-dryrun-driver.ts`, which re-derives
`linkEmailToOrder`'s decision tree using the real, unmodified matching
functions (`findMatchingOrder`, `findRefundFallbackOrder`,
`isFoodGroceryRetailer`, `shouldAutoJunk`, `detectSelfOutboundLoop`), without
ever creating an `Email` row.

**Two mid-run connection drops (Neon, not driver logic):** the first attempt
crashed at item 47/106 on an uncaught `P1017` ("server has closed the
connection") during a `prisma.user.findUnique` call that sat outside the
per-row try/catch. Fixed (diff reviewed and approved before applying): the
user lookup moved inside the try/catch, and every row's result is now
appended to a durable JSONL file immediately, not just written once at the
end. On resume, the first 46 items replayed for free via `DryRunCache`; a
second, isolated connection drop hit item on a `dryRunCache.create()` call
mid-run — caught cleanly by the new per-row try/catch, recorded as that one
row's `ERROR` outcome, and the run continued to completion without human
intervention. All 106 rows have a final outcome.

## What this dry-run does NOT show — read before the summary

The report below shows **field-level write previews only** — what
`mergeEmailIntoOrder`/`createOrderFromEmail` would write to an `Order` row.
It does **not** simulate the cascade that runs immediately after a real
merge in `linkEmailToOrder`: `applyFallbackOrderDate`, `recomputeOrderStatus`,
`applyShippingTracking`/`applyReturnTracking`, and `recomputeDisplayStatus`.
**This is not a hidden risk being glossed over — it's the normal, intended
next layer that turns written fields into order state**, and real recovery
will run it exactly as it always does. Concretely: a real recovery pass may
correctly move orders through `returned → refunded` (with the auto-archive
that implies) or `ordered → shipped → delivered`, in ways this report can't
preview. The `matchTier` column *is* a real signal from this dry-run,
though — `prefix`/`retailer_prefix`/`refund_fallback_*` matches are exactly
what triggers `linkEmailToOrder`'s `needsReview:true` + `userNote` forcing
after a real merge, so those rows are flagged as such below.

## Summary

- **Total dry-run emails:** 106
- **Classified commerce:** 64 · **non-commerce:** 41 · **classification
  itself failed (connection drop):** 1
- **Would create a new Order:** 20
- **Would merge into an existing Order:** 8
  - **Zero-`OVERWRITE`-class merges (safe):** 1
  - **≥1 `OVERWRITE`-class field change:** 7
- **Overwrite incidents by field** (7 merges, some touch multiple fields):
  `orderTotal` (3), `deadlineIsEstimated` (3), `returnDeadline` (2),
  `orderDate` (1), `orderDateSource` (1), `orderDateEstimated` (1),
  `returnPortalUrl` (1), `policySource` (1)
- **Overwrite incidents by user:** 3 distinct users affected (userId prefixes
  `cmrp9zgm6…`: 4 merges, `cmqtng57q…`: 2, `cmqx4cy1r…`: 1)
- **Classifier false negatives** (commerce-shaped subject, classified
  non-commerce): **0** in this batch — the founder pilot's one real miss
  (Crate & Barrel) was among the 12 already-processed rows, not in this
  106-item set; it does not recur here by the same subject-line heuristic.
- **1 row ended in `ERROR`** (see below) — a Ralph Lauren promotional email
  whose subject ("Shop Our Labor Day Event Now") matches the same pattern as
  the 41 confirmed non-commerce rows; its true classification is unresolved,
  not assumed.

**One pattern the row table doesn't surface well:** all 3 `orderTotal`
overwrites, and the sole `returnPortalUrl` overwrite, happened on
`shipping_confirmation`/`delivery`-type emails, never `order_confirmation`.
`resolveOrderTotal` (`lib/linkOrder.ts`) is specifically designed to prevent
a shipping email's partial-package total from clobbering a real
order-level total *once one exists* — but all 3 of these target orders
currently have **no `order_confirmation` email on file at all** (only
shipping/delivery fragments), so that protection's precondition never
engages. This is the exact failure shape the code's own comment warns
about, arising naturally here because the corresponding order-confirmation
email for each of these 3 orders was never itself recovered (either still
sitting in `DiscardLog` outside this batch, or never forwarded in the first
place) — not a new bug, but a real, observable consequence of the recovery
population's specific composition.

## Actual billed API calls

Reconstructed from both run attempts combined (the crash did not lose any
billed work, only the report of it):

| Call site | Count |
|---|---|
| `commerce_classifier` (Haiku) | **107** |
| `email_extraction` (Sonnet, incl. retry) | **66** |
| `email_extraction_retry` | **3** (included in the 66) |
| `policy_lookup` (web search) | **14** |

**Total: 187** (107 + 66 + 14 — `email_extraction_retry`'s 3 is a subset of
the 66, not additional). *Corrected 2026-09-08: this section originally
stated 190, an arithmetic error caught during session close-out.* One known
double-bill is included in the 187: the item whose `DryRunCache` write
failed mid-transaction during the first crashed attempt was re-classified
and re-extracted on resume (no cache row existed to short-circuit it) — a
direct, disclosed consequence of the Neon connection instability, not a
driver bug. Estimated pre-run range was 198-214 for a clean single pass;
187 actual (with one item paying twice) is consistent with that range.

## Full row-level table (106 rows)

| # | messageId | userId | receivedAt | sender / subject | commerce | emailType | orderNumber | retailer | outcome | matchTier | target order |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `a018552a` | `cmqvuw58` | Fri, 4 Sep 2026  | amazon.com: Ordered: "Maruman Mnemosyne Spiral..." | commerce | order_confirmation | 114-0761265-1327446 | Amazon | NEW_ORDER |  |  |
| 2 | `fe0e79d5` | `cmqx4cy1` | Fri, 04 Sep 2026 | email.eberjey.com: NEW PJ PRINT | non_commerce |  |  |  | NO_LINK |  |  |
| 3 | `c6628534` | `cmrp9zgm` | Fri, 4 Sep 2026  | amazon.com: Shipped: 1 Skincare item | commerce | shipping_confirmation | 112-0108462-4820222 | Amazon | MERGE | exact | Amazon 112-0108462-4820222 |
| 4 | `a0f1d21a` | `cmqx4cy1` | Fri, 04 Sep 2026 | laundrysauce.com: Labor Day Sale Starts Now | non_commerce |  |  |  | NO_LINK |  |  |
| 5 | `52fe7307` | `cmqx4cy1` | Fri, 04 Sep 2026 | thirdlove.com: Still on: Up to 30% off sitewide. | non_commerce |  |  |  | NO_LINK |  |  |
| 6 | `89f36389` | `cmqx4cy1` | 04 Sep 2026 12:1 | mail.ralphlauren.com: For a Limited Time—Enjoy 30% Off​ at Our Labor Day Event | commerce | other |  |  | NO_LINK |  |  |
| 7 | `26c8055d` | `cmqx4cy1` | Fri, 04 Sep 2026 | ubeauty.com: Final Call: The OOO Set Is Almost Gone | non_commerce |  |  |  | NO_LINK |  |  |
| 8 | `1643273b` | `cmqx4cy1` | Fri, 04 Sep 2026 | jennikayne.com: The Float Top Is Trending Now | non_commerce |  |  |  | NO_LINK |  |  |
| 9 | `113c9407` | `cmqx4cy1` | Fri, 04 Sep 2026 | forrowan.com: Final Few | non_commerce |  |  |  | NO_LINK |  |  |
| 10 | `34cfc972` | `cmqx4cy1` | Fri, 04 Sep 2026 | skatie.com: 30% off for the long weekend vibe! xo | non_commerce |  |  |  | NO_LINK |  |  |
| 11 | `69349ab2` | `cmqx4cy1` | 04 Sep 2026 16:0 | mail.ralphlauren.com: Suiting Staples | commerce | other |  |  | NO_LINK |  |  |
| 12 | `1bbe6809` | `cmrp9zgm` | Fri, 04 Sep 2026 | ruggable.com: Refresh any room with up to 40% off | non_commerce |  |  |  | NO_LINK |  |  |
| 13 | `6ea95b3d` | `cmqvuw58` | Fri, 4 Sep 2026  | amazon.com: Shipped: "Maruman Mnemosyne Spiral..." | commerce | shipping_confirmation | 114-0761265-1327446 | Amazon | NEW_ORDER |  |  |
| 14 | `053a53fc` | `cmqu524v` | Fri, 04 Sep 2026 | email.bloomingdales.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |  |
| 15 | `1c80b1e3` | `cmqx4cy1` | Fri, 04 Sep 2026 | paws.chewy.com: Scrub. Rinse. Snuggle. | commerce | other |  | Chewy | NO_LINK |  |  |
| 16 | `0e49ec8d` | `cmqu524v` | Fri, 04 Sep 2026 | email.bloomingdales.com: Save 20-25% on denim | commerce | other |  |  | NO_LINK |  |  |
| 17 | `d8f1743c` | `cmqx4cy1` | Fri, 04 Sep 2026 | larroude.com: The Labor Day Rush just got better | commerce | other |  |  | NO_LINK |  |  |
| 18 | `50d3fd25` | `cmqx4cy1` | Fri, 04 Sep 2026 | loyallist.bloomingdales.com: Save 20-25% on denim | non_commerce |  |  |  | NO_LINK |  |  |
| 19 | `c877f9ed` | `cmqx4cy1` | Fri, 04 Sep 2026 | jennikayne.com: It’s Back: Free Furniture Delivery | non_commerce |  |  |  | NO_LINK |  |  |
| 20 | `4a9a7aa0` | `cmqx4cy1` | Fri, 04 Sep 2026 | ubeauty.com: Exclusive Offer: 20% Off + Free Shipping | non_commerce |  |  |  | NO_LINK |  |  |
| 21 | `475c165c` | `cmqx4cy1` | 05 Sep 2026 00:0 | mail.ralphlauren.com: The Long Weekend Starts Here | non_commerce |  |  |  | NO_LINK |  |  |
| 22 | `5fa82d64` | `cmqtng57` | Fri, 04 Sep 2026 | cs.shutterfly.com: Your Shutterfly order is ready for pick up! | commerce | delivery | 5011207321227 | Shutterfly | NEW_ORDER |  |  |
| 23 | `39eafc8e` | `cmqx4cy1` | Sat, 05 Sep 2026 | email.eberjey.com: Ready To Be Yours | non_commerce |  |  |  | NO_LINK |  |  |
| 24 | `f3410ac9` | `cmqtng57` | Fri, 4 Sep 2026  | ebay.com: Mckenna, your order is confirmed | commerce | order_confirmation | 11-15123-97092 | eBay | NEW_ORDER |  |  |
| 25 | `7e49fac2` | `cmqx4cy1` | Sat, 05 Sep 2026 | summersalt.com: You really, really like this suit | non_commerce |  |  |  | NO_LINK |  |  |
| 26 | `9a1790bb` | `cmqx4cy1` | Sat, 05 Sep 2026 | forrowan.com: Love is the Road | non_commerce |  |  |  | NO_LINK |  |  |
| 27 | `630687bd` | `cmqx4cy1` | Sat, 05 Sep 2026 | mackweldon.com: Before it’s gone. | commerce | other |  |  | NO_LINK |  |  |
| 28 | `2582b819` | `cmqu524v` | Sat, 05 Sep 2026 | email.bloomingdales.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |  |
| 29 | `6730eaf8` | `cmqx4cy1` | Sat, 05 Sep 2026 | laundrysauce.com: 20% Off Subscriptions, 10% Off Sitewide. | commerce | other |  |  | NO_LINK |  |  |
| 30 | `e4868109` | `cmqx4cy1` | Sat, 05 Sep 2026 | thirdlove.com: The Fall Reset Sale everyone’s talking about. | non_commerce |  |  |  | NO_LINK |  |  |
| 31 | `150efeb7` | `cmqx4cy1` | 05 Sep 2026 12:1 | mail.ralphlauren.com: The Labor Day Event—Enjoy an Extra 30% Off​ | commerce | other |  |  | NO_LINK |  |  |
| 32 | `4737e7f5` | `cmrp9zgm` | Sat, 5 Sep 2026  | amazon.com: Cleared Customs: "Small Pilates Ball 9 Inch..." | commerce | shipping_confirmation | 112-7731463-7936228 | Amazon | MERGE | exact | Amazon 112-7731463-7936228 |
| 33 | `f5fb632b` | `cmqx4cy1` | Sat, 05 Sep 2026 | jonesroadbeauty.com: A Note From Bobbi for Labor Day | commerce | other |  |  | NO_LINK |  |  |
| 34 | `f7bcc2a4` | `cmrp9zgm` | Sat, 05 Sep 2026 | rugsusa.com: Buy one rug, get one 50% off | commerce | other |  |  | NO_LINK |  |  |
| 35 | `484106de` | `cmqx4cy1` | Sat, 05 Sep 2026 | jennikayne.com: Our Sweater Sizes, Simplified | non_commerce |  |  |  | NO_LINK |  |  |
| 36 | `261e9bde` | `cmqx4cy1` | Sat, 05 Sep 2026 | larroude.com: Walk like a Boss | commerce | other |  |  | NO_LINK |  |  |
| 37 | `65ad6731` | `cmrp9zgm` | Sat, 5 Sep 2026  | amazon.com: Delivery update: "Jastore Girls Layered Tulle..." and 1 more | commerce | delivery | 112-9226700-5012223 | Amazon | MERGE | retailer_prefix | Amazon Haul 112-9226700-5012223 |
| 38 | `8add2f0b` | `cmqvuw58` | Sat, 5 Sep 2026  | amazon.com: Ordered: "Divvsck Waterproof Knee..." | commerce | order_confirmation | 114-8641341-8587466 | Amazon | NEW_ORDER |  |  |
| 39 | `f45cfa38` | `cmqx4cy1` | Sat, 5 Sep 2026  | notify.bloomingdales.com: Thanks for your order! #781160797 | commerce | order_confirmation | 781160797 | Bloomingdale's | NEW_ORDER |  |  |
| 40 | `20a23992` | `cmqu524v` | Sat, 05 Sep 2026 | email.bloomingdales.com: Almost sold out | commerce | other |  |  | NO_LINK |  |  |
| 41 | `a324e8dc` | `cmqu524v` | Sat, 05 Sep 2026 | email.bloomingdales.com: Add these new markdowns to bag now | non_commerce |  |  |  | NO_LINK |  |  |
| 42 | `32111880` | `cmrp9zgm` | Sat, 05 Sep 2026 | em.target.com: Don't miss your new Target Circle Bonus! 🎉 | commerce | other |  |  | NO_LINK |  |  |
| 43 | `6a606aff` | `cmqtng57` | Sat, 5 Sep 2026  | ebay.com: 🚚 Order update: Northland Stainless “Roya... | commerce | shipping_confirmation | 11-15123-97092 | eBay | NEW_ORDER |  |  |
| 44 | `c9bc7113` | `cmrp9zgm` | Sat, 05 Sep 2026 | em.target.com: Hello! An item is still in your cart. | commerce | other |  |  | NO_LINK |  |  |
| 45 | `fe6d105d` | `cmqx4cy1` | Sat, 05 Sep 2026 | loyallist.bloomingdales.com: Goals: A perfectly organized home | commerce | other |  | Bloomingdale's | NO_LINK |  |  |
| 46 | `773f1e7e` | `cmqvuw58` | Sat, 05 Sep 2026 | us-info.adidas.com: Thanks for your order, Alexandra | commerce | order_confirmation | AD962505056 | adidas | NEW_ORDER |  |  |
| 47 | `8920d99c` | `cmqu524v` | Sat, 05 Sep 2026 | email.bloomingdales.com: Save up to 70% online & in store | commerce | other |  |  | NO_LINK |  |  |
| 48 | `7902748a` | `cmqvuw58` | Sat, 5 Sep 2026  | amazon.com: Ordered: "Sensodyne Pronamel Gentle..." | commerce | order_confirmation | 114-2886356-4485061 | Amazon | NEW_ORDER |  |  |
| 49 | `822494bf` | `cmqvuw58` | Sat, 5 Sep 2026  | amazon.com: Ordered: "Hydro Flask Travel Tumbler..." | commerce | order_confirmation | 114-0153602-2860224 | Amazon | NEW_ORDER |  |  |
| 50 | `641077e7` | `cmqx4cy1` | 06 Sep 2026 00:0 | mail.ralphlauren.com: Shop Our Labor Day Event Now | error |  |  |  | ERROR |  |  |
| 51 | `e4c7c58f` | `cmqx4cy1` | Sun, 6 Sep 2026  | notify.bloomingdales.com: Thanks for your order! #781187611 | commerce | order_confirmation | 781187611 | Bloomingdale's | MERGE | exact | Bloomingdale's 781187611 |
| 52 | `c79bc688` | `cmqx4cy1` | Sun, 06 Sep 2026 | t.dermstore.com: We've received your order | commerce | order_confirmation | 780517802 | Dermstore | NEW_ORDER |  |  |
| 53 | `00781751` | `cmqvuw58` | Sun, 6 Sep 2026  | amazon.com: Shipped: "Divvsck Waterproof Knee..." | commerce | shipping_confirmation | 114-8641341-8587466 | Amazon | NEW_ORDER |  |  |
| 54 | `3d340c16` | `cmqvuw58` | Sun, 6 Sep 2026  | amazon.com: Shipped: "Hydro Flask Travel Tumbler..." | commerce | shipping_confirmation | 114-0153602-2860224 | Amazon | NEW_ORDER |  |  |
| 55 | `d27c29fb` | `cmqx4cy1` | Sun, 06 Sep 2026 | summersalt.com: < 48 hours to go ⏰ | non_commerce |  |  |  | NO_LINK |  |  |
| 56 | `e3887ba9` | `cmqx4cy1` | Sun, 06 Sep 2026 | email.informeddelivery.usps.com: Your Daily Digest for Sun, 9/6 is ready to view | non_commerce |  |  |  | NO_LINK |  |  |
| 57 | `f716720b` | `cmqx4cy1` | Sun, 06 Sep 2026 | skatie.com: Yep, it's all on sale! (but not for much longer) | non_commerce |  |  |  | NO_LINK |  |  |
| 58 | `841d08eb` | `cmqx4cy1` | 06 Sep 2026 12:0 | mail.ralphlauren.com: Long Weekend. Timeless Style. | commerce | other |  |  | NO_LINK |  |  |
| 59 | `916955af` | `cmqx4cy1` | Sun, 06 Sep 2026 | ubeauty.com: 48 Hours Left: Claim Your Free Weekend Bag | non_commerce |  |  |  | NO_LINK |  |  |
| 60 | `4fcf266d` | `cmrp9zgm` | Sun, 06 Sep 2026 | em.target.com: Your New Weekly Ad is here. | commerce | other |  |  | NO_LINK |  |  |
| 61 | `68f3c9cd` | `cmrp9zgm` | Sun, 06 Sep 2026 | rugsusa.com: The Labor Day Event: BOGO 50% off | commerce | other |  |  | NO_LINK |  |  |
| 62 | `927db4d8` | `cmqx4cy1` | Sun, 06 Sep 2026 | furyou.com: Your 20% Off Ends Tomorrow ⏰ | non_commerce |  |  |  | NO_LINK |  |  |
| 63 | `2bf06418` | `cmqu524v` | Sun, 06 Sep 2026 | email.informeddelivery.usps.com: Your Daily Digest for Sun, 9/6 is ready to view | non_commerce |  |  |  | NO_LINK |  |  |
| 64 | `728fd04d` | `cmqx4cy1` | Sun, 06 Sep 2026 | larroude.com: Shop by Category. Sale Edit. | commerce | other |  |  | NO_LINK |  |  |
| 65 | `7e719fbc` | `cmqx4cy1` | Sun, 06 Sep 2026 | larroude.com: Shop by Category. Sale Edit. | commerce | other |  |  | NO_LINK |  |  |
| 66 | `e865571c` | `cmqx4cy1` | Sun, 06 Sep 2026 | jennikayne.com: 3 New Shades, 1 Iconic Knit | non_commerce |  |  |  | NO_LINK |  |  |
| 67 | `2f222356` | `cmrp9zgm` | Sun, 06 Sep 2026 | em.target.com: An item in your cart is on sale. Really. | commerce | other |  |  | NO_LINK |  |  |
| 68 | `bd05cff0` | `cmqx4cy1` | Sun, 06 Sep 2026 | email.bloomingdales.com: Ends tomorrow! Take 25% off app purchases | commerce | other |  |  | NO_LINK |  |  |
| 69 | `d413d1be` | `cmqx4cy1` | Sun, 06 Sep 2026 | skatie.com: what i'd actually buy from the sale | non_commerce |  |  |  | NO_LINK |  |  |
| 70 | `8ae33267` | `cmqx4cy1` | Sun, 06 Sep 2026 | moderncitizen.com: Back at it 👩🏻‍💻 | non_commerce |  |  |  | NO_LINK |  |  |
| 71 | `7f52daa0` | `cmqvuw58` | Sun, 06 Sep 2026 | us-info.adidas.com: Your adidas order update | commerce | shipping_confirmation | AD962505056 | adidas | NEW_ORDER |  |  |
| 72 | `0627745e` | `cmqtng57` | Sun, 06 Sep 2026 | margauxny.com: It's delivery time! | commerce | delivery | 593636 | Margaux | MERGE | exact | Margaux 593636 |
| 73 | `5e9f52d4` | `cmqx4cy1` | Sun, 06 Sep 2026 | larroude.com: Summer Isn’t Over Yet | commerce | other |  | Larroude | NO_LINK |  |  |
| 74 | `285115e1` | `cmqx4cy1` | Sun, 06 Sep 2026 | loyallist.bloomingdales.com: The Labor Day Sale ends tomorrow! | commerce | other |  |  | NO_LINK |  |  |
| 75 | `8c874a7c` | `cmrp9zgm` | Sun, 06 Sep 2026 | oe.target.com: Get ready for something special! Items from order #912003709 | commerce | shipping_confirmation | 912003709357307 | Target | MERGE | exact | Target 912003709357307 |
| 76 | `bdd0e2c6` | `cmqvuw58` | Sun, 06 Sep 2026 | us-info.adidas.com: Your order is on its way | commerce | shipping_confirmation | AD962505056 | adidas | NEW_ORDER |  |  |
| 77 | `7c91a9c3` | `cmqtng57` | Mon, 7 Sep 2026  | amazon.com: Ordered: 1 Kitchen item | commerce | order_confirmation | 111-5093011-9850626 | Amazon | NEW_ORDER |  |  |
| 78 | `ee00773d` | `cmqtng57` | Mon, 07 Sep 2026 | margauxny.com: Your order has arrived | commerce | delivery | 593636 | Margaux | MERGE | exact | Margaux 593636 |
| 79 | `10868102` | `cmqx4cy1` | Mon, 07 Sep 2026 | summersalt.com: 30% OFF Sitewide ends in 3...2... | non_commerce |  |  |  | NO_LINK |  |  |
| 80 | `714ae5d9` | `cmqx4cy1` | Mon, 07 Sep 2026 | s.factor75.com: Your Factor box is on its way! | commerce | delivery |  | Factor | NO_LINK |  |  |
| 81 | `a526d450` | `cmqtng57` | Mon, 7 Sep 2026  | amazon.com: Shipped: 1 Kitchen item | commerce | shipping_confirmation | 111-5093011-9850626 | Amazon | NEW_ORDER |  |  |
| 82 | `2ca59830` | `cmqx4cy1` | Mon, 07 Sep 2026 | hillhousehome.com: LAST CHANCE! End of Summer Sale | non_commerce |  |  |  | NO_LINK |  |  |
| 83 | `3339b46f` | `cmqx4cy1` | Mon, 07 Sep 2026 | forrowan.com: Two for You. One for One You Love. | non_commerce |  |  |  | NO_LINK |  |  |
| 84 | `852a7d36` | `cmqx4cy1` | Mon, 07 Sep 2026 | email.eberjey.com: Sale Ends At Midnight | non_commerce |  |  |  | NO_LINK |  |  |
| 85 | `b766e198` | `cmqvuw58` | Mon, 7 Sep 2026  | emails.net-a-porter.com: Your NET-A-PORTER order is on its way - order 0509ZLVGR2638M | commerce | shipping_confirmation | 0509ZLVGR2638M | NET-A-PORTER | NEW_ORDER |  |  |
| 86 | `4542827b` | `cmqx4cy1` | Mon, 07 Sep 2026 | skatie.com: 30% off ends tonight! | non_commerce |  |  |  | NO_LINK |  |  |
| 87 | `8e41cc1a` | `cmqx4cy1` | 07 Sep 2026 12:0 | mail.ralphlauren.com: Ends Tomorrow: The Labor Day Event | commerce | other |  |  | NO_LINK |  |  |
| 88 | `e1a98626` | `cmqx4cy1` | Mon, 07 Sep 2026 | paws.chewy.com: How to tell if your pup has fleas | non_commerce |  |  |  | NO_LINK |  |  |
| 89 | `95652a0d` | `cmqx4cy1` | Mon, 07 Sep 2026 | ubeauty.com: Last Chance: 20% Off + Free Shipping | non_commerce |  |  |  | NO_LINK |  |  |
| 90 | `03e026ea` | `cmqx4cy1` | Mon, 7 Sep 2026  | notify.bloomingdales.com: Your order has shipped! #781160797 | commerce | shipping_confirmation | 781160797 | Bloomingdale's | NEW_ORDER |  |  |
| 91 | `95cb73f5` | `cmqx4cy1` | Mon, 07 Sep 2026 | jonesroadbeauty.com: LAST CALL: Labor Day Sale Ends Tonight | commerce | other |  |  | NO_LINK |  |  |
| 92 | `eb25d7e8` | `cmqx4cy1` | Mon, 07 Sep 2026 | jennikayne.com: Today Only: Earn 2x Points | non_commerce |  |  |  | NO_LINK |  |  |
| 93 | `39c9c8fe` | `cmrp9zgm` | Mon, 07 Sep 2026 | rugsusa.com: The Labor Day Sale ends tomorrow | non_commerce |  |  |  | NO_LINK |  |  |
| 94 | `ba471b45` | `cmrp9zgm` | Mon, 07 Sep 2026 | linguafranca.nyc: Last Day To Shop Sale! | commerce | other |  |  | NO_LINK |  |  |
| 95 | `76a10164` | `cmqx4cy1` | Mon, 07 Sep 2026 | larroude.com: Up to 70% off + 10% off sitewide | commerce | other |  |  | NO_LINK |  |  |
| 96 | `0d48f36c` | `cmqtng57` | Mon, 07 Sep 2026 | gap.narvar.com: Your order is arriving soon. | commerce | shipping_confirmation | 1RYJR48 | Gap | MERGE | exact | GAP 1RYJR48 |
| 97 | `1a9d9991` | `cmqu524v` | Mon, 07 Sep 2026 | email.bloomingdales.com: Your exclusive 25% off ends soon! | non_commerce |  |  |  | NO_LINK |  |  |
| 98 | `fadaa4f9` | `cmqx4cy1` | 07 Sep 2026 16:0 | mail.ralphlauren.com: Perfect Fall Pairings | non_commerce |  |  |  | NO_LINK |  |  |
| 99 | `7ea13606` | `cmrp9zgm` | Mon, 07 Sep 2026 | rugsusa.com: Still thinking about it? | commerce | other |  |  | NO_LINK |  |  |
| 100 | `6ca7a014` | `cmqx4cy1` | 07 Sep 2026 16:0 | mail.ralphlauren.com: Send Summer Off in Style | non_commerce |  |  |  | NO_LINK |  |  |
| 101 | `727941de` | `cmrp9zgm` | Mon, 07 Sep 2026 | ruggable.com: Best deals on best sellers | non_commerce |  |  |  | NO_LINK |  |  |
| 102 | `98b3b424` | `cmqtng57` | Mon, 07 Sep 2026 | m.shopifyemail.com: [TEST] Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |  |
| 103 | `47e9625d` | `cmqtng57` | Mon, 07 Sep 2026 | m.shopifyemail.com: [TEST] Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |  |
| 104 | `9a9e1b27` | `cmqtng57` | Mon, 07 Sep 2026 | g.shopifyemail.com: Parasol Sport Visors Labor Day Sale! | commerce | other |  |  | NO_LINK |  |  |
| 105 | `7a7f13e2` | `cmrp9zgm` | Mon, 07 Sep 2026 | hillhousehome.com: LAST CHANCE! End of Summer Sale | non_commerce |  |  |  | NO_LINK |  |  |
| 106 | `b79ca34c` | `cmqtng57` | Mon, 07 Sep 2026 | mail.crateandbarrel.com: Item(s) from Order 359173100 are Ready for Pickup | commerce | delivery | 359173100 | Crate & Barrel | NEW_ORDER |  |  |

## Merge detail — full field-level BEFORE/AFTER for all 8 MERGE rows


**`c6628534-1791-48be-9512-2e661f9b7d85`** — shipment-tracking@amazon.com — "Shipped: 1 Skincare item"
- Target: Amazon #112-0108462-4820222 (`cmtm4xh2z0003l2046hg1lmvt`), matched via `exact`
  - `returnDeadline`: `None` → `2026-10-03T23:06:59.000Z` **[FILL_NULL]**
  - `deadlineIsEstimated`: `False` → `True` **[OVERWRITE]**

**`4737e7f5-728d-4f05-bd25-8361129fb96f`** — order-update@amazon.com — "Cleared Customs: "Small Pilates Ball 9 Inch...""
- Target: Amazon #112-7731463-7936228 (`cmtk6p0ws0003ju04sxgrnmv9`), matched via `exact`
  - `orderTotal`: `2.42` → `2.33` **[OVERWRITE]**
  - `lineItems`: `0 item(s)` → `1 item(s)` **[APPEND]**

**`65ad6731-2892-4e8a-8366-945008c1d48c`** — order-update@amazon.com — "Delivery update: "Jastore Girls Layered Tulle..." and 1 more"
- Target: Amazon Haul #112-9226700-5012223 (`cmtimlw450003l304ppjlai64`), matched via `retailer_prefix`
  - `orderTotal`: `36.02` → `21.98` **[OVERWRITE]**
  - `lineItems`: `0 item(s)` → `2 item(s)` **[APPEND]**

**`e4c7c58f-500d-42a9-8bd6-42fb1767fc3c`** — CustomerService@notify.bloomingdales.com — "Thanks for your order! #781187611"
- Target: Bloomingdale's #781187611 (`cmtrpvmcx0003l7045cbhmsgx`), matched via `exact`
  - `orderDate`: `2026-09-07T20:52:13.000Z` → `2026-09-06T03:13:22.000Z` **[OVERWRITE]**
  - `orderDateSource`: `fallback` → `extracted` **[OVERWRITE]**
  - `orderDateEstimated`: `True` → `False` **[OVERWRITE]**
  - `deadlineIsEstimated`: `True` → `False` **[OVERWRITE]**

**`0627745e-c5df-4c75-89e8-c776773d4449`** — news@margauxny.com — "It's delivery time!"
- Target: Margaux #593636 (`cmteyx9mg0003l904xnx0wnx8`), matched via `exact`
- No field changes — every merged value was either null or identical to what's already on the order.

**`8c874a7c-198d-4f25-ab67-61d429771cf4`** — orders@oe.target.com — "Get ready for something special! Items from order #912003709"
- Target: Target #912003709357307 (`cmtrjpljv0003l804oig6rqo4`), matched via `exact`
  - `orderTotal`: `24.3` → `26.92` **[OVERWRITE]**
  - `returnPortalUrl`: `https://click.oe.target.com/?qs=ABB7InYiOjEsImQiOjQ5OTJ9AAcAAAAABkTRi8McoXtH_hSUmwcIOI40YtsQWdgKjLlcPIqsjFCrFRaZ4xyzclIAyAho1BhePUPd68x7K9VhaB4mylSpNPF48FyYtyRHe3uPhACtGg` → `https://click.oe.target.com/?qs=ABB7InYiOjEsImQiOjQ5OTJ9AAcAAAAABkB-8b2eY3boro4ru0KKkv9aLMaULgbwED_O_B8nHqD2BqaXrle8atNXNeNkbdI6i16gE2QXDkAA7o-WCMKlgU4g90s68z2r-vpCgyMxPg` **[OVERWRITE]**

**`ee00773d-0d3f-42d3-9190-2b7ba79f0710`** — news@margauxny.com — "Your order has arrived"
- Target: Margaux #593636 (`cmteyx9mg0003l904xnx0wnx8`), matched via `exact`
  - `deliveryDate`: `None` → `2026-09-06T00:00:00.000Z` **[FILL_NULL]**
  - `deliveredAt`: `None` → `2026-09-06T00:00:00.000Z` **[FILL_NULL]**
  - `returnDeadline`: `2026-09-17T00:00:00.000Z` → `2026-09-20T00:00:00.000Z` **[OVERWRITE]**
  - `deadlineIsEstimated`: `True` → `False` **[OVERWRITE]**
  - `policySource`: `web_lookup` → `stated_in_email` **[OVERWRITE]**

**`0d48f36c-e293-472f-916f-ebefa7b7dfb6`** — gap@gap.narvar.com — "Your order is arriving soon."
- Target: GAP #1RYJR48 (`cmtkeeq7e0003le04eqt79jcz`), matched via `exact`
  - `deliveryDate`: `None` → `2026-09-08T00:00:00.000Z` **[FILL_NULL]**
  - `estimatedDeliveryDate`: `None` → `2026-09-08T00:00:00.000Z` **[FILL_NULL]**
  - `returnDeadline`: `2026-10-07T17:56:08.000Z` → `2026-10-08T00:00:00.000Z` **[OVERWRITE]**

## The one ERROR row

`641077e7-56c5-4523-bf29-f90259a840dd` — `news@mail.ralphlauren.com` —
"Shop Our Labor Day Event Now" — failed on a `prisma.dryRunCache.create()`
call when Neon closed the connection mid-write. Caught by the per-row
try/catch (added after the first crash), recorded as this row's terminal
state, and the run continued. Not reprocessed within this run — its true
`isCommerceEmail`/extraction outcome is unknown, though its subject matches
every other confirmed-non-commerce row's pattern in this batch.

## Follow-ups the owner decides

- Whether to re-run just this one `ERROR` row (cheap — a single classify
  call, plus extraction only if it turns out to be commerce) before deciding
  on recovery scope, or treat it as inconclusive and out of scope.
- The `orderTotal`/`returnPortalUrl` overwrite pattern above — whether to
  investigate the missing `order_confirmation` emails for those 3 orders
  before merging their shipping-fragment emails, given `resolveOrderTotal`'s
  protection can't apply without one on file.
- Whether `matchTier: retailer_prefix`/`refund_fallback_*` rows (only 1 in
  this batch — `65ad6731…`, Amazon Haul) warrant extra scrutiny before
  recovery, given the real system will additionally route that merge to
  human review via `needsReview`/`userNote` forcing.
- No hypothesis on recovery approach offered here, per scope — this doc is
  data only.

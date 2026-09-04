# Retailer name variants — 44 active, non-Amazon orders

Population: `archivedAt: null`, `deletedAt: null`, `!retailer.toLowerCase().includes("amazon")`
(matches `lib/amazonBundle.ts`'s `isAmazonOrder`), queried live via Prisma
(`prisma.order.findMany`, read-only) on 2026-09-02/03. 44 orders, 33 distinct raw
`Order.retailer` strings, 0 orders with a null or empty retailer.

## Grouped by best-guess canonical identity

Clean, single-string retailers (no variant issue — one raw string, used consistently):

- American Girl (2)
- Ancient Greek Sandals (1)
- Apple (1) — note: one *linked email* on this order says "Apple Store" instead of
  "Apple"; the Order-level field stayed "Apple" because it's write-once from the
  first-linked email (see derivation.md) — not a variant grouping problem at the
  Order level, but evidence the underlying Email rows are already inconsistent.
- Buff Beauty (1)
- Buff City Soap (2)
- Charmspring (1)
- Chewy (1)
- Credo Beauty (1)
- Goldbelly (1)
- H&M (1)
- Julia Amory (2)
- Loeffler Randall (1)
- Margaux (1)
- Market Hall Foods (1)
- NET-A-PORTER (3) — all-caps-with-hyphens is this brand's actual styling; the 3
  orders are internally consistent with each other, so this isn't a cross-order
  variant problem, just an unusual literal string.
- nmjlmajong (1) — see "Suspect / low-confidence extractions" below.
- Nordstrom (1)
- Oak Valley (1) — see "Truncated name" below.
- Quince (1)
- Rowing Pad (1)
- Rufflebutts + Ruggedbutts (1) — see "Ambiguous / co-branded" below.
- Shopbop (2)
- SSENSE (1)
- Target (2)
- The RealReal (3)
- VPL Bike (1)
- Wayfair (1)
- Zara (1)

Multi-string groups (same real-world retailer, different raw strings across orders):

- **Gap** — "Gap" (3 orders), "GAP" (1 order), "Gap Inc." (1 order) = 5 orders, 1 retailer.
- **Vespoli** — "Vespoli USA Inc" (1 order), "Vespoli Online Store" (1 order) = 2 orders,
  1 retailer. These two orders share the identical `orderNumber` (`SO86549`) and near-identical
  timestamps (14:30:17 vs 14:30:22) and both already resolved to the same
  `returnPortalUrl` (`https://store.vespoli.com/pages/returns`) — almost certainly the
  order-confirmation and shipping-confirmation emails for the *same purchase*, extracted
  under two different self-descriptions the retailer itself uses (legal entity name vs.
  storefront name), and never merged into one Order (see derivation.md for why — a plain
  `equals`/prefix retailer match wouldn't have caught this pair).

Grand total: 44 orders / 33 raw strings / **~28 real-world retailers** (33 minus the 5
Gap-string reduction to 1, minus the 2 Vespoli-string reduction to 1).

## Flagged: risky or ambiguous groupings

1. **"Rufflebutts + Ruggedbutts" — likely one co-branded retailer, not two.** The stored
   `returnPortalUrl` is `https://www.rufflebutts.com/returns` — a single domain — so this
   looks like one storefront that sells under two sibling brand names (a common pattern
   for children's apparel sister-brands under one parent). Treating it as "two retailers"
   would be wrong; treating it as one literal search string ("Rufflebutts + Ruggedbutts")
   is *probably* fine for a search engine, but it's an unusual formatting a naive
   "split on delimiter and take the first token" normalization step would mangle into just
   "Rufflebutts", silently dropping the co-brand.

2. **"Vespoli USA Inc" vs "Vespoli Online Store" — legal name vs. storefront name for the
   same company, not two companies.** Naive legal-suffix stripping ("strip Inc/LLC/USA")
   would turn "Vespoli USA Inc" into "Vespoli", which happens to still be correct here —
   but note the two strings don't even share a common substring pattern that a suffix-strip
   would reliably unify with "Vespoli Online Store" (stripping "Inc"/"USA" from the first
   doesn't get you any closer to matching the second without also handling "Online Store").
   A real fix needs either a shared canonical key both resolve to, or fuzzy/domain-based
   matching (they already share `returnPortalUrl`'s domain, which is the more reliable
   signal here — see view.md).

3. **"Buff Beauty" vs "Buff City Soap" — two distinct, unrelated retailers that share a
   "Buff" prefix.** This is exactly the collision risk the task asked to watch for: any
   normalization that strips words after the first token, or does prefix-matching with a
   short minimum length, would incorrectly merge these two into one. (`lib/linkOrder.ts`'s
   own `isRetailerPrefixMatch` guards against this today with `MIN_RETAILER_PREFIX_LENGTH`
   — worth checking that constant is long enough to keep "Buff" alone under the threshold;
   not verified in this investigation since it's a code-behavior question, not a data one.)

4. **"nmjlmajong" — looks like a garbled or wrong extraction, not a real retailer name.**
   Its `orderNumber` is `promo_9940606f-d148-44cd-98e6-e39c33f86673` (a UUID-shaped promo
   code, not a normal order number) and `returnPortalUrl` is null. This reads like a
   marketing/promo email that got mis-typed as a purchase, or a genuinely obscure brand
   name extracted correctly but unrecognizable to a human reviewer. Not independently
   verified against the source email (out of scope — no email body was decrypted/read
   for this investigation beyond the `retailer`/`retailerSource` fields already pulled).
   Flagging as a likely-bad search-query candidate regardless of the underlying cause.

5. **"Oak Valley" — plausibly a truncated version of "Oak Valley Designs."** The order's
   own `returnPortalUrl` is `oakvalleydesigns.com/pages/return-request-form` — the domain
   strongly suggests the retailer's actual name is "Oak Valley Designs," not bare "Oak
   Valley." If the search job used the stored string alone, it may not have needed to —
   the correct URL was already sitting in the same row. This is really a derivation
   observation (see derivation.md) more than a variants one, but it's a concrete example
   of a name that's "clean-looking" (no casing/punctuation issue) yet still incomplete.

6. **"Rowing Pad" / "VPL Bike" / "Charmspring"** — unusual-sounding names with no
   `returnPortalUrl` on file and, for two of the three, single-email orders (no
   corroborating second extraction to cross-check against). Not confirmed wrong, just
   unverified — flagged for a human reviewer to eyeball rather than assumed either way.

## Rough "search-usable as-is" count

- **~35 of 44 orders (~80%)** already have a raw `retailer` string that a search engine
  would almost certainly resolve to the right company without any preprocessing — casing
  and legal suffixes ("NET-A-PORTER", "GAP", "Gap Inc.") barely matter to web search, only
  to *exact-string deduplication*.
- **~7 of 44 orders (~16%)** — the Gap (5) and Vespoli (2) clusters — would each search
  fine *individually*, but sit under different raw strings that a naive per-order review
  sheet would show as unrelated rows for the same retailer. This is a dedup/grouping
  problem for the review sheet, not fundamentally a search-quality problem.
- **~3 of 44 orders (~7%)** — Rufflebutts + Ruggedbutts, Oak Valley, nmjlmajong — are the
  genuine search-quality risks: one ambiguous co-brand, one likely-truncated name, one
  likely-garbled extraction. Rowing Pad / VPL Bike / Charmspring (another ~3, ~7%) are
  unverified but not clearly bad.

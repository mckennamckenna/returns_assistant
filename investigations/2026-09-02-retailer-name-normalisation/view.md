# Recommendation: smallest change to make retailer names reliably search-usable

## What the data actually says (see schema.md / variants.md / derivation.md)

- No normalization exists today anywhere in the write path — `Order.retailer` is stored
  exactly as the AI extracted it from one email's body (or, rarely, sender-derived), and
  is set once, permanently, at Order creation.
- In practice, casing/legal-suffix variance ("Gap"/"GAP"/"Gap Inc.", "NET-A-PORTER") is
  cosmetic and won't meaningfully hurt a web search engine's ability to resolve the right
  company — search engines are forgiving of case and punctuation.
- The real risk isn't cosmetic variance, it's: (a) two different orders for the same
  retailer showing as unrelated rows on the review sheet because their raw strings differ
  ("Vespoli USA Inc" vs "Vespoli Online Store", 5 Gap orders across 3 spellings), and
  (b) a handful of names that are genuinely incomplete, garbled, or ambiguous regardless
  of casing ("Oak Valley" vs the likely real "Oak Valley Designs"; "nmjlmajong";
  "Rufflebutts + Ruggedbutts" as a co-brand). Roughly 7 of 44 orders (~16%) fall in bucket
  (a), and 3-6 of 44 (~7-14%) in bucket (b).

## Options weighed

**(a) A normalization function applied only at query-construction time, no schema/data
changes.** Cheapest to ship — pure code, no migration, fully reversible, can iterate
freely (add a case rule, tweak it, throw it away) without ever touching stored data.
Preserves the *most* optionality: nothing about the underlying `Order.retailer` values
changes, so any future, better approach (a lookup table, a canonical field) can still be
built on top of the same raw data later. The ceiling is real, though — a pure string
function (lowercase, strip "Inc"/"LLC"/"USA", collapse whitespace) fixes the Gap-style
cosmetic cases but cannot fix the Vespoli case (the two strings don't share a
suffix-strippable pattern) or the co-brand/truncation/garbled cases (variants.md #1, #4,
#5) — those need either a human's judgment or a different signal entirely (e.g. grouping
by `returnPortalUrl` domain instead of by retailer string, which the Vespoli pair already
demonstrates works: both rows already share the same portal domain even though their
retailer strings don't overlap).

**(b) A new canonical-name field on the Order model, backfilled once.** More durable than
(a) — a `canonicalRetailer` column, populated by a one-time backfill script (rule-based
or reviewed by a human against the current 44-row population) and then written going
forward at Order-creation time alongside the raw `retailer`. This directly fixes the
review-sheet grouping problem (bucket (a) above) since the review sheet could group on
the canonical field. Cost: a migration (additive — nullable new column, fine under this
repo's own migration-risk rules) plus a backfill pass that, per this repo's data-changes
rule, would need to be reasoned through and shown, even though additive migrations don't
require sign-off. More commitment than (a): once other code starts reading
`canonicalRetailer`, it's no longer a pure "delete the function and nothing changes"
experiment.

**(c) A dedicated retailer lookup/mapping table.** Most durable, most correct long-term
(handles many-to-one mapping explicitly, could carry the retailer's actual domain,
support future features like per-retailer policy caching), but the most build cost for
an *alpha* job whose whole point is finding out whether search-and-verify works at all.
At 44 orders / ~28 real retailers, a full mapping table is solving a scale problem this
alpha doesn't have yet.

## Recommendation for this specific alpha job

**Option (a) — a normalization function applied only at query-construction time — plus
one deliberate exception: prefer `returnPortalUrl`'s domain over the retailer string when
a `returnPortalUrl` already exists on the order.** Reasoning:

- This is a weekly *alpha*, explicitly a review-sheet-with-a-human-in-the-loop, not a
  fully-automated pipeline. The owner is already going to eyeball every candidate URL
  before approving it — cosmetic near-misses (a Gap-cluster URL and a GAP-cluster URL
  both resolving to gap.com, shown as two separate rows) are a minor annoyance in a
  spreadsheet, not a correctness bug, at this volume (44 orders, ~7 in the affected
  clusters).
- The genuinely bad cases (nmjlmajong, Oak Valley truncation, Rufflebutts co-brand) are
  not casing/suffix problems — no normalization function fixes them. They need a human
  reviewer's eyes regardless of which option is chosen, so building (b) or (c) now buys
  no additional correctness on exactly the rows that matter most.
- Every order in this dataset that already has a `returnPortalUrl` on file (most of them
  — see the ground-truth CSV) already encodes the retailer's real domain more reliably
  than its own name string does (the Oak Valley and Vespoli cases both demonstrate this:
  the URL domain is unambiguous even when the name string is truncated or legal-vs-DBA
  inconsistent). Since the search job's purpose is specifically to find URLs for orders
  that *don't* already have a trustworthy one, this matters less for the alpha's actual
  target population than it might first appear — but it's still the cheapest available
  win, and it costs nothing beyond the normalization function itself.
- (a) ships with zero migration risk and zero backfill decision, which matters given this
  repo's single-production-database posture — nothing here needs the owner's migration
  sign-off.

If the alpha proves out and this becomes a recurring, larger-scale job, revisit toward
(b): a canonical field is the natural next step once there's real evidence of how often
the review sheet actually needs cross-order retailer grouping at volume higher than 44
orders. (c) is not worth building until (b)'s backfill process itself becomes painful to
maintain by hand.

## Specific risky cases to carry into the alpha job's design

- **"Rufflebutts + Ruggedbutts"** — one retailer (single domain, `rufflebutts.com`), not
  two. Don't split on "+" when constructing a query.
- **"Vespoli USA Inc" vs "Vespoli Online Store"** — same company, storefront name differs
  from the legal/DBA name found in shipping paperwork. A naive legal-suffix strip doesn't
  unify these two strings with each other; the reliable shared signal is the
  `returnPortalUrl` domain both orders already carry, not the retailer string.
- **"Buff Beauty" vs "Buff City Soap"** — two unrelated retailers sharing a "Buff" prefix.
  Any normalization step that truncates to the first word, or does short-minimum-length
  prefix matching, must not merge these.
- **"Oak Valley"** — likely truncated; the real name is probably "Oak Valley Designs"
  (per its own `returnPortalUrl` domain, `oakvalleydesigns.com`). A "clean-looking" name
  isn't the same as a complete one.

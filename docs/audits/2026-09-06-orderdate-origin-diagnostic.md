# orderDate origin diagnostic — Order 1RYJR48

Scope: read-only trace of why Order 1RYJR48's `orderDate` is
`2026-09-02T17:56:08.000Z` labeled `orderDateSource: "extracted"` /
`orderDateEstimated: false`, despite the owner confirming none of the
linked emails state an order date in their body. Zero writes, zero
model calls. No fix proposed or scoped here.

## Summary

The label is **not truthful**. `Order.orderDate` came from the
order_confirmation email's `anchorDate`, which the Anchor Date Resolver
(`ANCHOR_DATE_RESOLVER.md`, `app/api/inbound/route.ts`) itself set via
its own `receivedAt` fallback (`anchorSource: "received_at"`) — i.e.
the resolver found no better signal (no forwarded-header date) and
used arrival time as a last resort, honestly marking that fact in
`anchorSource`. The bug is one layer up: `lib/linkOrder.ts`'s
`resolveExtractedOrderDate()` (lines 770-771) treats *any*
order_confirmation email's `anchorDate` as equivalent to a genuinely
AI-extracted stated date, without checking `anchorSource` first. That
function's output then gets written to `Order.orderDate` with
`orderDateSource: "extracted"` by `createOrderFromEmail` (the function
that instantiated this Order, since the order_confirmation was the
first email linked). Both linked emails' own `Email.orderDate` fields
are correctly null — the AI extraction step never fabricated
anything. The mislabel originates entirely in the linking layer, not
the extraction layer.

## Step 1 — Confirm the linked Emails

Query used (join via `Email.orderId → Order.id`, confirmed against
`prisma/schema.prisma`):

```ts
const order = await prisma.order.findFirst({ where: { orderNumber: "1RYJR48" } });
const emails = await prisma.email.findMany({
  where: { orderId: order.id },
  select: { id, subject, receivedAt, emailType, extractedAt, orderDate, confidence, needsReview },
  orderBy: { receivedAt: "asc" },
});
```

All field names matched the schema exactly — no substitutions needed.

Result: **2 linked Emails**, not 3:

| id | subject | receivedAt | emailType | extractedAt | orderDate | confidence | needsReview |
|---|---|---|---|---|---|---|---|
| `cmtkedq3...` | Order Confirmation #1RYJR48 | 2026-09-02T17:56:08Z | order_confirmation | 2026-09-06T19:45:29Z | null | low | true |
| `cmtlnhza...` | An update to your order #1RYJR48 | 2026-09-03T14:59:11Z | shipping_confirmation | 2026-09-03T14:59:23Z | null | low | true |

A follow-up subject-string search (`subject contains "1RYJR48"`,
unscoped to `orderId`) returned only these same 2 rows — no
third, unlinked email exists in the DB with this order number in its
subject. **This partially confirms, partially diverges from the
owner's inbox observation**: the confirmation email and one shipping
email match; the owner recalls a *second* shipping notification that
isn't showing up in the DB at all (not linked to a different order,
not junked — simply not found by subject-string search). Possible
explanations (not investigated further — out of scope): that second
email's subject line doesn't contain "1RYJR48" literally, it was never
forwarded/received by Postmark, or it's a duplicate Gmail didn't
distinguish from the one row that does exist. This is a gap between
owner's inbox and the DB, separate from the orderDate question, and is
flagged in "worth a future item?" below rather than chased here.

Both linked emails show `confidence: "low"` and `Email.orderDate: null`
— consistent with the 2026-09-06 Gap extraction diagnostic's finding
that Gap's `order_confirmation` body yields no usable extracted fields
(orderNumber comes from the subject line instead), and consistent with
TASKS.md's note that this row was already reprocessed under the
retry-trigger fix and still couldn't recover `orderDate` from either
body variant.

## Step 2 — Trace which Email supplied Order.orderDate

`Order.orderDate` = `2026-09-02T17:56:08.000Z`.

- order_confirmation email `receivedAt` = `2026-09-02T17:56:08.000Z` — **exact match**.
- shipping_confirmation email `receivedAt` = `2026-09-03T14:59:11.000Z` — no match.

Confirms the owner's hypothesis: `Order.orderDate` equals the
confirmation email's arrival time to the second, despite the
"extracted" label.

## Step 3 — Trace which code path wrote it, by inspection

Grepped `lib/*.ts` for every `orderDate:` write site. Three files
write `orderDate` (on `Order` or `Email`); no other file in `lib/` or
`scripts/` does:

- **`lib/runExtraction.ts:115`** — `orderDate: result.orderDate ? new Date(result.orderDate) : null` writes the AI's raw extraction result straight onto `Email.orderDate`. No receivedAt fallback here; null in means null written. This path produced the (correct) null on both linked Email rows.

- **`lib/extract.ts:646-680`** — the Gap-fill retry mechanism (2026-09-06 fix) that merges a second extraction pass (over `resolveBodyTextWithAlternate`'s alternate body) into pass 1's result when pass 1 looks blank. `gapFilled.orderDate = retry.orderDate` (line 677) only pulls from another genuine AI extraction (`retry.orderDate`), never from `receivedAt`. Confirmed by the DB state: 1RYJR48 was already reprocessed under this exact mechanism per TASKS.md, and `Email.orderDate` stayed null because the retry's own extraction also came back null for order date.

- **`lib/linkOrder.ts`** — four write sites on `Order.orderDate`, all gated through one shared helper:
  - `resolveExtractedOrderDate()` (lines 770-771): `email.orderDate ?? (email.emailType === "order_confirmation" ? email.anchorDate : null)`. **This is the mislabel's root** — it silently substitutes `anchorDate` for a null `orderDate` on order_confirmation emails, treating the substitution as equally "extracted" regardless of `anchorSource`.
  - `createOrderFromEmail()` (lines 893, 899, 913): seeds a brand-new Order from the first linked email. Writes `orderDate: extractedOrderDate` and `orderDateSource: extractedOrderDate ? "extracted" : undefined` — i.e. whatever `resolveExtractedOrderDate()` returned gets labeled "extracted" unconditionally. **This is the exact write site that produced 1RYJR48's current row** (see Step 4).
  - `mergeEmailIntoOrder()` (lines 828-858): the provenance-aware merge for a second-or-later linked email. Same `resolveExtractedOrderDate()` call; writes `orderDateSource: "extracted"` whenever `canOverwriteOrderDate && extractedOrderDate != null`. Not the write site here (this Order had no prior emails when the confirmation linked), but carries the identical mislabel risk for any order whose *second* email is the one supplying an order_confirmation's anchorDate.
  - `rebuildOrderFromRemainingEmails()` (lines 939-989): re-seeds an order from scratch after an email is split off; same `resolveExtractedOrderDate()` dependency, same mislabel risk, not implicated in this Order's history since it has never had an email split off.
  - `applyFallbackOrderDate()` (lines 201-237): the *other* Order.orderDate writer — labels honestly as `orderDateSource: "fallback"` / `orderDateEstimated: true` and only fires `if (!order || order.orderDate) return` — i.e. only when orderDate is still unset. **Not implicated**: by the time this would have run for 1RYJR48, `createOrderFromEmail` had already set orderDate (to the anchorDate value), so this function's early-return fired and it never touched the row.

- **Anchor Date Resolver** (`app/api/inbound/route.ts`, per `ANCHOR_DATE_RESOLVER.md`, not itself an `orderDate` writer but the upstream source `resolveExtractedOrderDate` trusts): computes `Email.anchorDate`/`anchorSource` once at ingestion. For this email: `anchorDate: 2026-09-02T17:56:08.000Z`, `anchorSource: "received_at"`, `forwardType: "auto"` — confirmed via direct query. `anchorSource: "received_at"` is the resolver's own honest label meaning "no forwarded-header date was found; fell back to arrival time." The resolver's labeling is accurate; the problem is that `resolveExtractedOrderDate()` one layer up discards `anchorSource` entirely and treats the value as unconditionally "extracted."

## Step 4 — Cross-reference Steps 2 and 3

Verdict: **"Extraction path wrote receivedAt as orderDate and labeled
it extracted" — with the specific mechanism being one layer removed
from raw extraction.** The chain is:

1. Anchor Date Resolver (ingestion-time, `app/api/inbound/route.ts`) set `Email.anchorDate = receivedAt` and `anchorSource = "received_at"` for this order_confirmation, because no forwarded-header date existed to parse (this labeling is itself correct and not in question).
2. `lib/extract.ts`'s AI extraction correctly returned `orderDate: null` for this email (no date stated in body) — also correct.
3. `lib/linkOrder.ts`'s `resolveExtractedOrderDate()` (line 771) fell through the `??` to `email.anchorDate` *because* the emailType is `order_confirmation`, without checking whether `anchorSource` indicated a real signal or a fallback.
4. Since this was the first (and, at the time, only) email linked, `createOrderFromEmail()` (line 893-913) wrote that value onto the new Order as `orderDate: <anchorDate>`, `orderDateSource: "extracted"` — unconditionally, since `resolveExtractedOrderDate()` returned non-null.
5. `applyFallbackOrderDate()` ran immediately after (per `linkEmailToOrder`'s call order) but no-opped because `order.orderDate` was already set, so the honestly-labeled `"fallback"` path never got a chance to apply here.

## Step 5 — Confirm or refute "label is truthful"

**NO.** `orderDateSource: "extracted"` + `orderDateEstimated: false`
is supposed to mean "we found a real order date stated in the email
content." For 1RYJR48, no linked email states an order date anywhere
in its body — the AI extraction step correctly returned null both
times reprocessed. The value on the Order is arrival time,
laundered through `anchorDate` (itself an honest `receivedAt`
fallback) and then mislabeled "extracted" by `resolveExtractedOrderDate()`'s
order_confirmation-only substitution, which does not distinguish
`anchorSource: "received_at"` (a guess) from `anchorSource:
"original_header"` or `"quoted_body"` (a real signal recovered from
the email itself).

## Scope note for a future fix (not a recommendation)

Any fix would need to touch `resolveExtractedOrderDate()`'s handling
of the order_confirmation `anchorDate` fallback — specifically,
deciding what to do when `anchorSource` is `"received_at"` (a guess)
versus `"original_header"`/`"quoted_body"` (a real signal). That
decision has knock-on effects on `orderDateSource` semantics
project-wide (the schema comment's own definition of "extracted" would
need to either exclude this case or the field's meaning would need
updating), and on every existing Order whose orderDate was seeded this
way, which is a backfill/relabeling question rather than a pure
code-path fix. This diagnostic does not recommend a label semantic
change or a specific Bug 8 phase — that's explicitly out of scope per
the task brief.

## Worth a future item?

- The 2 vs. 3 linked-email discrepancy noted in Step 1 (owner recalls
  a second shipping notification not present in the DB for 1RYJR48) —
  separate question from orderDate provenance, not investigated here.
- The other 3 Gap Orders referenced in the earlier spot-check likely
  share this exact mechanism (order_confirmation as the first-linked
  email, no forwarded-header date, `anchorSource: "received_at"`) —
  not queried here per the single-Order scope constraint, but the code
  path (`resolveExtractedOrderDate` + `createOrderFromEmail`) applies
  identically to any order whose first linked email is an
  order_confirmation with no recoverable forwarded date.
- `mergeEmailIntoOrder()` and `rebuildOrderFromRemainingEmails()`
  carry the identical `resolveExtractedOrderDate()` dependency, so the
  same mislabel can occur even when an order_confirmation is not the
  *first* email linked to an order — this diagnostic only confirmed
  the `createOrderFromEmail` write site for 1RYJR48 specifically,
  since that's what applied here.

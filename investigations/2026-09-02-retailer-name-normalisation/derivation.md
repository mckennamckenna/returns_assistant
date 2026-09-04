# Where `Order.retailer` actually comes from

## The merge rule: write-once from the first-linked email, never updated

`lib/linkOrder.ts` has two entry points that can produce/touch an Order's `retailer`
field: `createOrderFromEmail` (new Order) and `mergeEmailIntoOrder` (existing Order gains
another linked email).

`createOrderFromEmail` (line ~845) sets it directly from the triggering email, verbatim:

```ts
const created = await prisma.order.create({
  data: {
    userId,
    retailer: email.retailer,
    orderNumber: email.orderNumber,
    ...
```

`mergeEmailIntoOrder` (line ~785) — the function every *later* email for the same Order
goes through — updates orderDate, deliveryDate, returnWindowDays, returnPortalUrl,
lineItems, orderTotal, and more, all with explicit merge logic. **`retailer` is not in
that update's `data` object at all.** Read the full `prisma.order.update({ data: {...} })`
call starting at line 811: every field it touches is listed (orderDate, orderDateSource,
orderDateEstimated, deliveryDate, estimatedDeliveryDate, deliveredAt,
returnWindowDays/StartsFrom, returnDeadline, deadlineIsEstimated, policySource,
orderTotal, orderCurrency, lineItems, returnPortalUrl) — `retailer` is absent.

**Conclusion: `Order.retailer` is set exactly once, at Order creation, from whichever
email happened to create the Order (normally the earliest-received linked email) — and
is never revisited, corrected, or merged again, no matter what later-linked emails say.**
This is the same "write-once" pattern the codebase's own comments describe as a
previously-fixed *bug* for `orderDate` (see the `orderDateSource` provenance mechanism
added 2026-08-27 specifically to stop write-once from locking in a wrong value) — but no
equivalent provenance-aware fix exists for `retailer`. If the first-linked email's
retailer extraction is wrong, incomplete, or just differently-styled than a later email's,
that's what the Order is stuck with permanently.

## Verified against the 44-order sample

- Every order's `Order.retailer` exactly equals its earliest-linked `Email.retailer`
  (confirmed programmatically: for all 44 orders, `order.retailer === order.emails[0]
  .retailer`, ordered by `receivedAt` ascending).
- 2 of the 44 orders have a *second* linked email whose own `retailer` differs from the
  first (and thus from the Order's stored value):
  - Apple order: first email says "Apple", a later email says "Apple Store" — the Order
    kept "Apple".
  - GAP order (`cmtkeeq7e...`): first email says "GAP", a later one says "Gap" — the Order
    kept "GAP".
  In both cases the discrepancy is invisible at the Order level; it only surfaces by
  reading the linked Email rows directly, which the review sheet as currently scoped
  (Order-level) would not do.

## Provenance breakdown (`retailerSource`)

For the **first-linked email of each of the 44 orders** (i.e. whatever established the
Order's stored `retailer`):

| retailerSource | orders |
|---|---|
| `body_extraction` | 43 |
| `sender_fallback` | 1 (Zara — `ZARA_RETAILER_FALLBACK`, 2026-08-25; the AI's body
extraction returned null, so the sender's `fromName`/domain resolved it instead) |
| `carrier_deferred` | 0 |
| null | 0 |

Across **all 109 emails linked to these 44 orders** (not just the first per order):
`body_extraction` 104, `sender_fallback` 5, `carrier_deferred` 0, null 0.

So in this population, retailer identity is overwhelmingly LLM-read-from-body
(`body_extraction`), not sender/domain-derived — the sender-fallback path only fired for
Zara. This matters for normalization design: most raw strings are whatever the retailer's
own email body phrased its name as (varies by template/team within the same company —
hence "Gap" vs "GAP" vs "Gap Inc." even though it's a single retailer), not a
consistently-formatted domain-derived string.

## `retailer: null` / empty / obviously-wrong count

**Zero** of the 44 active non-Amazon orders have a null or empty-string `retailer`. Every
order has *some* non-empty value. "Obviously wrong" is a judgment call — see variants.md's
flagged list (nmjlmajong, Oak Valley, Rufflebutts + Ruggedbutts, and the three unverified
oddities) for the closest thing to "wrong" found in this sample: **0 null, ~3 likely
name-quality issues, ~3 more unverified/unusual**, out of 44.

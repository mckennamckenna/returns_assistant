# Ground-truth spreadsheet — query notes, 2026-09-02

## Query (read-only, Prisma `findMany`, no writes)

```js
prisma.order.findMany({
  where: {
    archivedAt: null,       // reminderOrderWhere() / activeOrderFilter — lib/orderFilters.ts
    deletedAt: null,
    returnPortalUrl: { not: null },
  },
  select: { id: true, retailer: true, orderDate: true, returnPortalUrl: true },
})
```

Then filtered out any row where `isAmazonOrder(retailer)` is true (`lib/amazonBundle.ts`:
case-insensitive substring match on `"amazon"` in the `retailer` field — the same check
the reminder cron itself uses to skip Amazon orders, so this population matches exactly
who is reminder-eligible).

Sorted by `retailer` (case-insensitive, alphabetical), then `orderDate` ascending within
retailer. Orders with a null `orderDate` sort first within their retailer group (treated
as epoch 0).

## Counts

- Active, non-archived, non-deleted orders with a non-null `returnPortalUrl` (before
  Amazon filter): **53**
- Amazon-family excluded: **17**
- **Final population written to `return-urls.csv`: 36**

## Reconciling against the brief's "~59" estimate

The brief estimated ~59 based on "52/91 active had returnPortalUrl populated, minus
Amazon" from the 2026-09-01 fleet investigation (TASKS.md). That 52 was the count across
*all* active orders (Amazon included), not non-Amazon only, so subtracting Amazon orders
from it directly overcounts — Amazon orders that DO have a populated `returnPortalUrl`
still need to come out.

The actual number reconciles cleanly against two numbers already on record from earlier
2026-09-02 sessions:
- The same-day `domain-audit.md` (from the extraction root-cause investigation) counted
  **44** active, reminder-eligible non-Amazon orders total.
- The 2026-09-02 "coverage gap investigated, no build warranted" closed item found **8**
  of those 44 have no `returnPortalUrl` at all (the genuine long-tail coverage gap,
  already investigated and closed separately).

44 total − 8 with no URL = **36** with a populated URL — exactly what this query
returned. No discrepancy once the Amazon-populated orders are correctly excluded from
the 52, not the 91.

## Scope note

This population is a superset of the 19 bad URLs from the earlier root-cause
investigation (all 19 are active, non-Amazon, non-null `returnPortalUrl` orders) — every
one of those 19 rows appears in this CSV too, alongside the 17 that were found good in
the 2026-09-01 fleet audit's live-fetch pass.

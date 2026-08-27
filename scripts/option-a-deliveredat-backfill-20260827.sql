-- Option A backfill: deliveredAt from anchorDate for auto-forwarded
-- delivery emails with no body-extractable date.
--
-- Design doc: DELIVERED_BADGE_DESIGN_20260827.md
-- Build session: TASKS.md 2026-08-27, commit implementing
-- lib/linkOrder.ts's resolveDeliveredAtBackfill/recomputeDisplayStatus.
--
-- NOT EXECUTED. For owner review + manual run against the production
-- Neon database (per CLAUDE.md: this app has one database, not
-- separate dev/prod — every run of this file IS a production write).
--
-- Scope re-verified live at build time, 2026-08-27
-- (scripts/pm-diag-option-a-scope-verify-20260827.ts): 10 orders match,
-- not the 3 the design doc estimated from an incomplete peer query (that
-- query filtered on estimatedDeliveryDate being non-null AND in the past,
-- which silently excluded orders whose estimatedDeliveryDate is null —
-- those still have a null deliveredAt and still need this backfill, they
-- just don't show the same "Arrives <date>" chip text today; without a
-- date to show, orderCardChip's awaiting_delivery branch falls back to
-- the displayStatus label, which happens to already read "Delivered" —
-- so deliveredAt is just as wrong on these rows, only invisible in the
-- one place the bug was originally spotted). See owner-facing summary
-- for the full 10-row list with retailer names.
--
-- Criteria (must match lib/linkOrder.ts's resolveDeliveredAtBackfill
-- exactly, so a fresh inbound email processed AFTER this backfill runs
-- computes the identical result the code would have produced — this SQL
-- does not depend on the code change having deployed first, and running
-- it twice is a no-op the second time since the WHERE clause re-excludes
-- any Order whose deliveredAt is already set):
--   - Email.emailType = 'delivery'
--   - Email.forwardType = 'auto'
--   - Email.deliveryDate IS NULL (no body-extracted date)
--   - Email.anchorDate IS NOT NULL (forward resolver has a value)
--   - Order.deliveredAt IS NULL (never overwrite an existing value)
--   - Order.displayStatus = 'delivered' (only orders actually showing
--     this bug's symptom today — an order that hasn't reached
--     "delivered" yet has no bug to backfill)
--
-- When an order has more than one qualifying delivery email (a
-- re-delivery or multiple packages), the earliest anchorDate is used —
-- the first confirmed delivery event — matching resolveDeliveredAtBackfill.

-- ── STEP 1: SELECT — eyeball this before running the UPDATE ────────────────
WITH candidate_emails AS (
  SELECT
    "orderId",
    MIN("anchorDate") AS "earliestAnchorDate"
  FROM "Email"
  WHERE "emailType" = 'delivery'
    AND "forwardType" = 'auto'
    AND "deliveryDate" IS NULL
    AND "anchorDate" IS NOT NULL
    AND "orderId" IS NOT NULL
  GROUP BY "orderId"
)
SELECT
  o.id,
  o."userId",
  o.retailer,
  o."orderNumber",
  o."displayStatus",
  o."deliveredAt" AS "current_deliveredAt",
  ce."earliestAnchorDate" AS "will_backfill_to",
  o."estimatedDeliveryDate"
FROM "Order" o
JOIN candidate_emails ce ON ce."orderId" = o.id
WHERE o."deliveredAt" IS NULL
  AND o."displayStatus" = 'delivered'
ORDER BY o."updatedAt" DESC;

-- Expected: 10 rows as of 2026-08-27 (re-verify the count is still current
-- before running STEP 2 — new orders may have entered this state since).

-- ── STEP 2: UPDATE — run only after reviewing STEP 1's output ──────────────
WITH candidate_emails AS (
  SELECT
    "orderId",
    MIN("anchorDate") AS "earliestAnchorDate"
  FROM "Email"
  WHERE "emailType" = 'delivery'
    AND "forwardType" = 'auto'
    AND "deliveryDate" IS NULL
    AND "anchorDate" IS NOT NULL
    AND "orderId" IS NOT NULL
  GROUP BY "orderId"
)
UPDATE "Order" o
SET "deliveredAt" = ce."earliestAnchorDate"
FROM candidate_emails ce
WHERE ce."orderId" = o.id
  AND o."deliveredAt" IS NULL
  AND o."displayStatus" = 'delivered';

-- Idempotent: a second run matches zero rows, since every row it touched
-- the first time now has deliveredAt IS NOT NULL and no longer satisfies
-- the WHERE clause.

-- ── ROLLBACK — only if this fix needs to be undone ──────────────────────────
-- Resets deliveredAt to null for exactly the rows this backfill would have
-- touched (identified by anchorDate equality, not "every delivered order",
-- so it can't accidentally null out a deliveredAt that was set some other
-- way before or after this backfill ran).
--
-- WITH candidate_emails AS (
--   SELECT
--     "orderId",
--     MIN("anchorDate") AS "earliestAnchorDate"
--   FROM "Email"
--   WHERE "emailType" = 'delivery'
--     AND "forwardType" = 'auto'
--     AND "deliveryDate" IS NULL
--     AND "anchorDate" IS NOT NULL
--     AND "orderId" IS NOT NULL
--   GROUP BY "orderId"
-- )
-- UPDATE "Order" o
-- SET "deliveredAt" = NULL
-- FROM candidate_emails ce
-- WHERE ce."orderId" = o.id
--   AND o."deliveredAt" = ce."earliestAnchorDate";

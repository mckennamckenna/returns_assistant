-- orderDate provenance backfill: label every existing Order's
-- orderDateSource, and correct orderDate where a genuinely more
-- authoritative signal is available.
--
-- Diagnosis: TASKS.md 2026-08-27 ("orderDate write-once locks in the wrong
-- email's date"), commit 179389e. Build: this session, lib/linkOrder.ts's
-- resolveExtractedOrderDate/mergeEmailIntoOrder/createOrderFromEmail/
-- applyFallbackOrderDate, prisma/schema.prisma's orderDateSource field.
-- Priority rule confirmed via a dedicated read-only investigation the same
-- date (scripts/pm-investigate-orderdate-priority-rules-20260827.ts) before
-- writing this file — see that script's output for the coverage numbers.
--
-- NOT EXECUTED. For owner review + manual run against the production Neon
-- database (per CLAUDE.md: this app has one database, not separate
-- dev/prod — every run of this file IS a production write).
--
-- ── THE RULE ─────────────────────────────────────────────────────────────
-- For every Order currently orderDateSource = 'unknown' (every row as of
-- this migration — see prisma/migrations/20260827224554_add_order_date_source):
--   PRIORITY 1 — a linked order_confirmation email has a non-null
--     AI-extracted orderDate (a real, body-stated date) → use it.
--   PRIORITY 2 — no priority-1 signal, but that order_confirmation has a
--     non-null anchorDate (lib/forwardResolver.ts's forward-header-parsed
--     or receivedAt-derived date) → use it. This is specifically what
--     corrects Zara #54421192781: its order_confirmation's own AI-extracted
--     orderDate field was null, but the forwarded header's real send date
--     (Aug 16) was captured as anchorDate.
--   NEITHER — no order_confirmation, or one with no signal in either
--     field → label orderDateSource = 'fallback' WITHOUT changing
--     orderDate. Documents current provenance; a future incoming email can
--     still correct it via lib/linkOrder.ts's runtime rule.
--
-- Deliberately NOT extended to shipping_confirmation/delivery emails'
-- anchorDate (a "priority 3") — a same-date investigation found this would
-- additionally resolve Shopbop #143429832 (36/100 residual orders overall),
-- but that broadening was only explored as an unvalidated hypothesis, not
-- adopted. Shopbop and 6 other previously-flagged orders (MANGO F4VLSF,
-- Ruti 424051, Bettervits USA 444466, H&M 66993117803, Sidekick SK213978,
-- Tuckernuck TNK6875105) remain uncorrected by this backfill — confirmed
-- via a targeted read-only check before writing this file. They get
-- labeled 'fallback' (or stay 'unknown' if even that's ambiguous — see
-- STEP 2B) like every other unresolved row, not silently skipped.
--
-- ── RETURN DEADLINE ──────────────────────────────────────────────────────
-- Correcting orderDate alone does NOT update returnDeadline — that's only
-- recomputed by application code (lib/linkOrder.ts, lib/extract.ts's
-- computeDeadline) when a new email links at ingestion time, never by a
-- raw SQL UPDATE. Since the whole point of fixing orderDate is that the
-- deadline was wrong too, STEP 2A also recomputes returnDeadline using
-- computeDeadline's own case-1 formula (lib/extract.ts): fires only when
-- returnWindowStartsFrom is 'order_date' or NULL (the deadline actually
-- anchors on orderDate in that case) and returnWindowDays is known.
-- Orders whose returnWindowStartsFrom is explicitly 'delivery_date' are
-- deliberately left untouched here — their deadline anchors on a delivery
-- signal, not orderDate, so correcting orderDate correctly has no effect
-- on their returnDeadline, matching computeDeadline's own priority ladder.
-- deadlineIsEstimated is set true only when returnWindowStartsFrom was
-- NULL (matching computeDeadline's own `returnWindowStartsFrom == null`
-- case), left as its prior value when returnWindowStartsFrom is
-- explicitly 'order_date' (a real stated policy anchor, not itself newly
-- estimated by this correction).

-- ── STEP 1: SELECT — eyeball this before running STEP 2 ────────────────────
WITH order_confirmation_candidates AS (
  SELECT
    "orderId",
    "orderDate" AS extracted_order_date,
    "anchorDate" AS extracted_anchor_date,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY CASE WHEN "orderDate" IS NOT NULL THEN 0 ELSE 1 END, "receivedAt" ASC
    ) AS rn
  FROM "Email"
  WHERE "emailType" = 'order_confirmation'
    AND "orderId" IS NOT NULL
    AND ("orderDate" IS NOT NULL OR "anchorDate" IS NOT NULL)
),
best_candidate AS (
  SELECT
    "orderId",
    extracted_order_date,
    extracted_anchor_date,
    COALESCE(extracted_order_date, extracted_anchor_date) AS best_date
  FROM order_confirmation_candidates
  WHERE rn = 1
)
SELECT
  o.id,
  o."userId",
  o.retailer,
  o."orderNumber",
  o."orderDate" AS current_order_date,
  o."returnDeadline" AS current_return_deadline,
  o."returnWindowDays",
  o."returnWindowStartsFrom",
  bc.best_date AS will_set_order_date_to,
  CASE
    WHEN bc.extracted_order_date IS NOT NULL THEN 'priority 1 (order_confirmation extracted orderDate)'
    WHEN bc.extracted_anchor_date IS NOT NULL THEN 'priority 2 (order_confirmation anchorDate)'
    ELSE 'fallback (label only, orderDate unchanged)'
  END AS rule,
  CASE
    WHEN bc.best_date IS NOT NULL
      AND o."returnWindowDays" IS NOT NULL
      AND (o."returnWindowStartsFrom" = 'order_date' OR o."returnWindowStartsFrom" IS NULL)
    THEN bc.best_date + (o."returnWindowDays" * INTERVAL '1 day')
    ELSE o."returnDeadline"
  END AS will_set_return_deadline_to
FROM "Order" o
LEFT JOIN best_candidate bc ON bc."orderId" = o.id
WHERE o."orderDateSource" = 'unknown'
ORDER BY o."updatedAt" DESC;

-- Expected shape (from the 2026-08-27 investigation, re-verify live before
-- running STEP 2 — new orders may have entered/left this state since):
--   ~198 rows total (every order, since this migration just shipped).
--   ~50 rows: rule = priority 1.
--   ~48 rows: rule = priority 2 (Zara #54421192781 among these —
--     will_set_order_date_to should read 2026-08-16 05:13:00,
--     will_set_return_deadline_to should read 2026-09-15 05:13:00).
--   ~100 rows: rule = fallback (label only) — includes Shopbop #143429832
--     and the 6 other previously-flagged orders; orderDate stays unchanged
--     for all of these, by design (see comment above).

-- ── STEP 2A: UPDATE — orderDate correction + returnDeadline recompute ──────
WITH order_confirmation_candidates AS (
  SELECT
    "orderId",
    "orderDate" AS extracted_order_date,
    "anchorDate" AS extracted_anchor_date,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY CASE WHEN "orderDate" IS NOT NULL THEN 0 ELSE 1 END, "receivedAt" ASC
    ) AS rn
  FROM "Email"
  WHERE "emailType" = 'order_confirmation'
    AND "orderId" IS NOT NULL
    AND ("orderDate" IS NOT NULL OR "anchorDate" IS NOT NULL)
),
best_candidate AS (
  SELECT "orderId", COALESCE(extracted_order_date, extracted_anchor_date) AS best_date
  FROM order_confirmation_candidates
  WHERE rn = 1
)
UPDATE "Order" o
SET
  "orderDate" = bc.best_date,
  "orderDateSource" = 'extracted',
  "orderDateEstimated" = false,
  "returnDeadline" = CASE
    WHEN o."returnWindowDays" IS NOT NULL
      AND (o."returnWindowStartsFrom" = 'order_date' OR o."returnWindowStartsFrom" IS NULL)
    THEN bc.best_date + (o."returnWindowDays" * INTERVAL '1 day')
    ELSE o."returnDeadline"
  END,
  "deadlineIsEstimated" = CASE
    WHEN o."returnWindowDays" IS NOT NULL AND o."returnWindowStartsFrom" IS NULL THEN true
    ELSE o."deadlineIsEstimated"
  END
FROM best_candidate bc
WHERE bc."orderId" = o.id
  AND o."orderDateSource" = 'unknown';

-- ── STEP 2B: UPDATE — label-only for orders with no correctable signal ────
UPDATE "Order" o
SET "orderDateSource" = 'fallback'
WHERE o."orderDateSource" = 'unknown'
  AND NOT EXISTS (
    SELECT 1 FROM "Email" e
    WHERE e."orderId" = o.id
      AND e."emailType" = 'order_confirmation'
      AND (e."orderDate" IS NOT NULL OR e."anchorDate" IS NOT NULL)
  );

-- Idempotent: after both run once, no row is orderDateSource = 'unknown'
-- anymore, so re-running STEP 2A/2B a second time matches zero rows in
-- either. STEP 1's SELECT (WHERE orderDateSource = 'unknown') will return
-- 0 rows after a successful run — same idempotency check pattern as the
-- Option A backfill.

-- ── ROLLBACK — only if this fix needs to be undone ──────────────────────────
-- Resets every row this backfill touched back to orderDateSource =
-- 'unknown'. Does NOT attempt to restore the original (pre-backfill)
-- orderDate/returnDeadline values for the priority-1/2 rows — those were
-- overwritten in STEP 2A and are not separately preserved anywhere. If a
-- true rollback of VALUES (not just the label) is ever needed, restore
-- from a pre-backfill database snapshot instead of this file.
--
-- UPDATE "Order" SET "orderDateSource" = 'unknown' WHERE "orderDateSource" IN ('extracted', 'fallback');

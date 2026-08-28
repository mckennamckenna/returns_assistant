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
--   NEITHER — no order_confirmation, one with no signal in either field, OR
--     (see DISAGREEMENT EXCLUSION below) multiple order_confirmation
--     emails whose signals conflict → label orderDateSource = 'fallback'
--     WITHOUT changing orderDate. Documents current provenance; a future
--     incoming email can still correct it via lib/linkOrder.ts's runtime
--     rule.
--
-- Deliberately NOT extended to shipping_confirmation/delivery emails'
-- anchorDate (a "priority 3") — a same-date investigation found this would
-- additionally resolve Shopbop #143429832 (36/100 residual orders overall),
-- but that broadening was only explored as an unvalidated hypothesis, not
-- adopted. Shopbop and 6 other previously-flagged orders (MANGO F4VLSF,
-- Ruti 424051, Bettervits USA 444466, H&M 66993117803, Sidekick SK213978,
-- Tuckernuck TNK6875105) remain uncorrected by this backfill — confirmed
-- via a targeted read-only check before writing this file. They get
-- labeled 'fallback' like every other unresolved row, not silently
-- skipped. Separately: a read-only check found all 6 of those orders'
-- emails predate the forward resolver (shipped 2026-07-26) and were never
-- classified at all — re-running the resolver against pre-resolver rows
-- (not done here) would very likely recover real anchorDate values for
-- all of them. Tracked as its own TASKS.md entry, not folded into this
-- backfill.
--
-- ── DISAGREEMENT EXCLUSION (added after owner review of the first draft) ──
-- The initial version of this backfill picked "the earliest order_confirmation
-- with a signal" as the winner whenever an order had more than one such
-- email — without checking whether multiple emails' own signals actually
-- agreed. Caught before running: Fitness Superstore #48868 has two
-- order_confirmation-typed emails with non-null orderDate that disagree by
-- a full YEAR (2025-07-09 vs. 2026-07-09 — the latter is correct, matching
-- this order's own createdAt; the former is a pre-existing, already-
-- documented extraction bug, ANCHOR_DATE_RESOLVER.md's deferred Part 3
-- "wrong year" sanity guard). The original candidate-selection logic
-- (earliest-received wins) picked the WRONG one and would have corrupted
-- an already-correct value. Fix: if an order's order_confirmation emails
-- have multiple non-null values for the priority-firing field (orderDate
-- for priority 1, anchorDate for priority 2 — checked only when no
-- order_confirmation has orderDate at all) that fall on different
-- calendar days (same-day-different-time is NOT a disagreement — that's
-- normal timestamp-vs-date-only noise), the order is excluded from
-- auto-correction entirely and falls through to the fallback label. No
-- attempt is made to guess which of the disagreeing values is right —
-- per owner decision, "we don't trust ourselves to."
-- Verified against production (read-only) before finalizing this file:
-- excludes exactly Fitness Superstore #48868. Does NOT exclude Waitrose
-- #1058208405 (only ONE order_confirmation has a non-null anchorDate, so
-- there's nothing to disagree with under this rule, even though that one
-- signal is itself a poor proxy — a reschedule notice 3 weeks after the
-- real order). Accepted as-is per owner: Waitrose is a grocery order,
-- out of this product's scope, its orderDate accuracy doesn't affect any
-- decision the app makes for it.
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
WITH order_confirmations AS (
  SELECT "orderId", "orderDate", "anchorDate", "receivedAt"
  FROM "Email"
  WHERE "emailType" = 'order_confirmation' AND "orderId" IS NOT NULL
),
agreement_check AS (
  SELECT
    "orderId",
    COUNT(DISTINCT DATE_TRUNC('day', "orderDate")) FILTER (WHERE "orderDate" IS NOT NULL) AS distinct_orderdate_days,
    COUNT(DISTINCT DATE_TRUNC('day', "anchorDate")) FILTER (WHERE "anchorDate" IS NOT NULL) AS distinct_anchordate_days
  FROM order_confirmations
  GROUP BY "orderId"
),
ranked_candidates AS (
  SELECT
    "orderId",
    "orderDate" AS extracted_order_date,
    "anchorDate" AS extracted_anchor_date,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY CASE WHEN "orderDate" IS NOT NULL THEN 0 ELSE 1 END, "receivedAt" ASC
    ) AS rn
  FROM order_confirmations
  WHERE "orderDate" IS NOT NULL OR "anchorDate" IS NOT NULL
),
best_candidate AS (
  SELECT rc."orderId", rc.extracted_order_date, rc.extracted_anchor_date,
    COALESCE(rc.extracted_order_date, rc.extracted_anchor_date) AS best_date
  FROM ranked_candidates rc
  JOIN agreement_check ac ON ac."orderId" = rc."orderId"
  WHERE rc.rn = 1
    -- DISAGREEMENT EXCLUSION — see header comment.
    AND NOT (rc.extracted_order_date IS NOT NULL AND ac.distinct_orderdate_days > 1)
    AND NOT (rc.extracted_order_date IS NULL AND rc.extracted_anchor_date IS NOT NULL AND ac.distinct_anchordate_days > 1)
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
    ELSE 'fallback (label only, orderDate unchanged — no signal, or disagreeing signals excluded)'
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

-- Expected shape (verified live against production 2026-08-27, re-verify
-- before running STEP 2 — new orders may have entered/left this state
-- since): 198 rows total.
--   5 rows get a real VALUE correction (rule = priority 1 or 2 AND
--     will_set_order_date_to differs from current_order_date): Zara
--     #54421192781 (Aug 22 → Aug 16), Ulta Beauty #M223726065 (Jul 25 →
--     Jul 24), SKIMS #SB33487073 (Jul 31 19:47 → Jul 31 00:00), SSENSE
--     #44266308515307 (Jul 31 → Jul 30), Waitrose #1058208405 (Jul 14 →
--     Aug 5, accepted despite being a weak proxy — grocery, out of
--     product scope).
--   ~92 more rows: rule = priority 1 or 2, but will_set_order_date_to
--     equals current_order_date already — relabels source to 'extracted'
--     with no value change.
--   ~101 rows: rule = fallback — includes Fitness Superstore #48868
--     (disagreement-excluded), Shopbop #143429832, the 6 other
--     previously-flagged orders, and every order with no order_confirmation
--     signal at all. orderDate unchanged for all of these, by design.

-- ── STEP 2A: UPDATE — orderDate correction + returnDeadline recompute ──────
WITH order_confirmations AS (
  SELECT "orderId", "orderDate", "anchorDate", "receivedAt"
  FROM "Email"
  WHERE "emailType" = 'order_confirmation' AND "orderId" IS NOT NULL
),
agreement_check AS (
  SELECT
    "orderId",
    COUNT(DISTINCT DATE_TRUNC('day', "orderDate")) FILTER (WHERE "orderDate" IS NOT NULL) AS distinct_orderdate_days,
    COUNT(DISTINCT DATE_TRUNC('day', "anchorDate")) FILTER (WHERE "anchorDate" IS NOT NULL) AS distinct_anchordate_days
  FROM order_confirmations
  GROUP BY "orderId"
),
ranked_candidates AS (
  SELECT
    "orderId",
    "orderDate" AS extracted_order_date,
    "anchorDate" AS extracted_anchor_date,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY CASE WHEN "orderDate" IS NOT NULL THEN 0 ELSE 1 END, "receivedAt" ASC
    ) AS rn
  FROM order_confirmations
  WHERE "orderDate" IS NOT NULL OR "anchorDate" IS NOT NULL
),
best_candidate AS (
  SELECT rc."orderId", COALESCE(rc.extracted_order_date, rc.extracted_anchor_date) AS best_date
  FROM ranked_candidates rc
  JOIN agreement_check ac ON ac."orderId" = rc."orderId"
  WHERE rc.rn = 1
    AND NOT (rc.extracted_order_date IS NOT NULL AND ac.distinct_orderdate_days > 1)
    AND NOT (rc.extracted_order_date IS NULL AND rc.extracted_anchor_date IS NOT NULL AND ac.distinct_anchordate_days > 1)
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
-- Fires for: no order_confirmation at all, one with no signal in either
-- field, OR (via the same agreement_check/best_candidate logic as STEP 2A)
-- disagreeing signals excluded from auto-correction — Fitness Superstore
-- #48868 lands here, not in STEP 2A, because of the exclusion above.
WITH order_confirmations AS (
  SELECT "orderId", "orderDate", "anchorDate", "receivedAt"
  FROM "Email"
  WHERE "emailType" = 'order_confirmation' AND "orderId" IS NOT NULL
),
agreement_check AS (
  SELECT
    "orderId",
    COUNT(DISTINCT DATE_TRUNC('day', "orderDate")) FILTER (WHERE "orderDate" IS NOT NULL) AS distinct_orderdate_days,
    COUNT(DISTINCT DATE_TRUNC('day', "anchorDate")) FILTER (WHERE "anchorDate" IS NOT NULL) AS distinct_anchordate_days
  FROM order_confirmations
  GROUP BY "orderId"
),
ranked_candidates AS (
  SELECT
    "orderId",
    "orderDate" AS extracted_order_date,
    "anchorDate" AS extracted_anchor_date,
    ROW_NUMBER() OVER (
      PARTITION BY "orderId"
      ORDER BY CASE WHEN "orderDate" IS NOT NULL THEN 0 ELSE 1 END, "receivedAt" ASC
    ) AS rn
  FROM order_confirmations
  WHERE "orderDate" IS NOT NULL OR "anchorDate" IS NOT NULL
),
best_candidate AS (
  SELECT rc."orderId"
  FROM ranked_candidates rc
  JOIN agreement_check ac ON ac."orderId" = rc."orderId"
  WHERE rc.rn = 1
    AND NOT (rc.extracted_order_date IS NOT NULL AND ac.distinct_orderdate_days > 1)
    AND NOT (rc.extracted_order_date IS NULL AND rc.extracted_anchor_date IS NOT NULL AND ac.distinct_anchordate_days > 1)
)
UPDATE "Order" o
SET "orderDateSource" = 'fallback'
WHERE o."orderDateSource" = 'unknown'
  AND NOT EXISTS (SELECT 1 FROM best_candidate bc WHERE bc."orderId" = o.id);

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

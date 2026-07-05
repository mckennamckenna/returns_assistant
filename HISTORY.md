# HISTORY.md — Return Window

Chronological build log, most-recent-first. Preserves commit hashes, root causes,
backfill counts, and verification details removed from BUILD.md and TASKS.md.

---

## 2026-07-05 — Bugs 9+10+11: refund-amount-aware status branching + linkOrder fallback (`b91354f`)

**Design shift — explicit:** BUILD.md's original rule was "refunded is never
auto-derived" — only a manual "Mark as refunded" click could reach that status. This is
now superseded. Retailer refund emails turned out to be inconsistent about what they
actually confirm: "your refund is processed" often means "we received your package" or
"we started the refund," not "the money is in your account." Since catching exactly that
kind of vagueness is the product's reason to exist, treating every refund email as
equally trustworthy would have been the wrong call. The new rule branches on whether the
email states a *confirmed* dollar amount:
- **Confirmed amount** (e.g. Shopbop's "$123.05" stated as the refund total) → advances
  straight to `"refunded"` — chapter closed, auto-archives, no further reminders.
- **No confirmed amount** (e.g. H&M's "we're processing your refund," no dollar figure
  anywhere in the body) → advances only to `"returned"` — deliberately **not**
  archived, so the pre-existing refund check-in reminder (cron-driven off
  `displayStatus === "returned"`, unchanged) naturally nudges the user later to verify
  the money actually landed. No new "scheduling" code was needed for this — the
  check-in cron's own query already covers it once an order lands in this state.

**Problem, three symptoms of the same root cause:** Lola Blankets was linked correctly
but stuck at `displayStatus: "ordered"` despite having a refund email — `deriveDisplayStatus()`
had no case for `refund` emailType at all. Shopbop and H&M refund emails were orphaned
(`orderId: null`) because their bodies had no order number, and the linking gate required
one unconditionally for every email type.

**Diagnosis, done before any code was written** (`scripts/diagnose-refund-orphans.mjs`,
read-only against production): the H&M refund email had no `lineItems`/`orderTotal`
either — a generic "how your refund method works" email with zero itemized signal — but
exactly one existing H&M order for that retailer. Shopbop's refund email had a real
`orderTotal` ($123.05) and `lineItems`, but there was no existing Shopbop order at all —
checked and ruled out a retailer-name-mismatch theory against the known duplicate
"On (On-Running)" order rows first (`scripts/diagnose-shopbop-on.mjs`) — the original
purchase confirmation for this Shopbop order was simply never forwarded.

**What changed:**
- `lib/extract.ts`: new `refundAmount`/`refundAmountConfidence` extraction fields,
  distinct from `orderTotal` — only set when a dollar figure is unambiguously labeled as
  the refund/credit amount; the prompt explicitly forbids reusing `orderTotal` as a
  stand-in. New `Email.refundAmount`/`refundAmountConfidence` columns (migration
  `20260705154212_add_refund_amount`); `runExtraction.ts` persists them.
- `lib/displayStatus.ts`: `deriveDisplayStatus()` takes a new `hasConfirmedRefundAmount`
  param — a `refund` emailType now routes to `"refunded"` or `"returned"` depending on
  it, checked *before* the return_requested-or-higher early-return that gates the rest
  of the ladder (a refund email is the one auto-derivation signal allowed to move an
  order past that point on its own; the final rank comparison, not the early-return,
  still protects against downgrade in both branches). `buildStatusTransitionData()`
  generalized to backfill `returnedAt` on the direct-to-`"refunded"` jump too, not just
  `"returned"` — needed since these orders can now skip `"returned"` entirely, unlike
  the two manual endpoints which always gate `"refunded"` behind an existing `"returned"`
  status first.
- `lib/linkOrder.ts`: `recomputeDisplayStatus()` now queries `refundAmount`/
  `refundAmountConfidence` alongside `emailType`, computes the confirmed-amount flag
  across all linked refund emails, and switches to building its update via the shared
  `buildStatusTransitionData()` (a third caller, alongside both manual endpoints) instead
  of its own ad-hoc object — this is what makes auto-archive apply on the refunded branch
  and *not* apply on the returned branch, for free, with no duplicated logic.
- `lib/linkOrder.ts`: new `findRefundFallbackOrder()` — scoped strictly to
  `emailType === "refund"` with a missing `orderNumber` (does not loosen the
  `orderNumber` requirement for any other email type). Tiered, most specific first: (1)
  line-item name overlap against candidate orders for the same retailer, (2) `orderTotal`
  soft match (loose `<=`, not exact equality — refunds are frequently partial), (3)
  recency (the retailer's only order, or its most recently created one). Every fallback
  match sets `needsReview: true` + a `userNote` audit line, matching the existing
  retailer-prefix-match convention. When there's no candidate order for that retailer at
  all, falls through to `createOrderFromEmail()` (unmodified) rather than leaving the
  email permanently orphaned.
- BUILD.md updated in the same commit: Email-first principle section, the `displayStatus`
  behavioral-rules section, and the Order linking section all describe the new rule.
- 14 new tests in `__tests__/displayStatus.test.ts`: the refund branching (confirmed vs.
  no-confirmed-amount, from every starting rank, no-downgrade in both directions, a
  refund email evaluated alongside other signals) and `buildStatusTransitionData()`'s
  `returnedAt` backfill on the direct-to-refunded jump.

**Backfill** (`scripts/backfill-refund-status.ts`, dry-run reviewed and confirmed before
`--apply`) — reused the existing, already-tested `runExtraction()` directly rather than
duplicating its logic, since a single call re-extracts *and* re-links *and* re-derives
status. Scoped to `emailType: "refund"` (exactly 3 rows). Real outcomes, confirming the
design worked exactly as intended:
- **H&M** — refund email states no dollar figure at all → no confirmed amount. The order
  was already manually `refunded` from an earlier workaround (the refunded-misclick fix,
  2026-07-03) — since the nominal target here is only `"returned"` (a lower rank), the
  never-downgrade rule correctly left it untouched. Net effect: the previously-orphaned
  email now links correctly (fixing the orphan), no status change.
- **Shopbop** — refund email states "$123.05" as the refund total → confirmed amount,
  high confidence. No existing order for this retailer → a new, deliberately sparse
  Order was created directly from the refund email (no `orderDate`, no prior line-item
  pricing history — expected, not a bug, given no purchase confirmation was ever seen) →
  `refunded`, auto-archived.
- **Lola Blankets** — refund email states "Total amount refunded: $541.41" → confirmed
  amount, high confidence → advanced from `ordered` straight to `refunded`, auto-archived,
  `returnedAt` backfilled.

**Verified:** `npx vitest run` (111/111) + `npm run build` before deploy. Deployed via
`npx vercel --prod` (`dpl_YpVggqytjeHyU9w4QQRbq9xhunPa`), aliased to
`app.myreturnwindow.com`. **Owner hand-verified in production** — confirmed all three
orders show the expected status/archive state on the dashboard.

---

## 2026-07-04 — Bug 8: orderDate fallback generalized, orderDateEstimated flag (`92c6161`)

**Problem:** Amazon orders were permanently stuck with `orderDate: null` — no return
deadline could ever be computed for them.

**Diagnosis, done before any code was written:** a read-only script
(`scripts/diagnose-amazon-orderdate.mjs`) against the 3 real Amazon orders in production
found both linked emails per order (subjects "Ordered: ..." and "Shipped: ...")
classified as `shipping_confirmation` — Amazon never produces an `order_confirmation`
emailType at all. The existing fallback (`resolveFallbackOrderDate` in
`lib/linkOrder.ts`) only searched for `emailType: "order_confirmation"`, so it never
found a candidate. Checked further (`scripts/inspect-amazon-rawjson.mjs`): neither the
text nor HTML body of these emails contains a forwarded-header "Date:" text line either
(Amazon relays directly via SES, no manually-forwarded quote block) — so even
broadening the emailType filter alone wouldn't have helped. Confirmed Postmark's own
parsed `Date` header for the email is already captured faithfully as `Email.receivedAt`
(`app/api/inbound/route.ts:135`) — exact match against the raw Postmark payload's `Date`
field for the email checked.

**What changed:**
- `lib/linkOrder.ts`: `resolveFallbackOrderDate()` generalized from
  `order_confirmation`-only to the earliest linked email of any type. Two tiers: (1)
  `parseForwardedHeaderDate()` on the body, when a real forwarded-header Date line
  exists (still the more precise source); (2) otherwise the email's own `receivedAt`.
  `parseForwardedHeaderDate` exported for direct unit testing (previously module-private).
- `prisma/schema.prisma`: new `Order.orderDateEstimated` (migration
  `20260704204310_add_order_date_estimated`) — distinct from `deadlineIsEstimated`, so
  the UI can indicate the order date itself was inferred, not stated.
- `mergeEmailIntoOrder()`: clears `orderDateEstimated` back to `false` if a later email
  supplies a genuinely-extracted `orderDate` that supersedes the fallback value (a
  latent staleness gap found while making this change — previously the flag, once set,
  never cleared even after a real date arrived).
- `rebuildOrderFromRemainingEmails()`: explicit `orderDateEstimated: false` in its
  from-scratch reset step, re-derived by the trailing `applyFallbackOrderDate()` call if
  still missing.
- UI: `app/page.tsx` (dashboard table row) and `app/orders/[id]/page.tsx` (order detail)
  now show "(est.)" next to `orderDate`, mirroring the existing `deadlineIsEstimated`
  pattern exactly.
- BUILD.md's Order linking section updated to describe the generalized fallback.
- 5 new tests in `__tests__/linkOrder.test.ts` for `parseForwardedHeaderDate` (Gmail
  format, Apple Mail format including the narrow no-break space before AM/PM, the
  Amazon no-forwarded-header case returning `null`, empty body).

**Backfill:** `scripts/backfill-amazon-orderdate.ts` (new, kept), scoped deliberately to
`retailer contains "amazon"` — dry run surfaced 6 total orders with `orderDate: null`,
but only the 3 Amazon ones were in scope for today (H&M, Tuckernuck, and Lola Blankets
are separate, already-tracked issues — flagged in TASKS.md, not swept up here). Dry run
reviewed and confirmed by owner; `--apply` updated all 3: `orderDate` set from each
order's earliest `shipping_confirmation` email's `receivedAt` (none had a parseable
forwarded-header Date line), `orderDateEstimated: true`, `returnDeadline` recomputed
(orderDate + 7-day shipping buffer + 30-day window, since `deliveryDate` was also null).

**Verified:** `npx vitest run` (100/100) + `npm run build` before deploy. Deployed via
`npx vercel --prod` (`dpl_76GagvFjJagNFvEUJDMiYR8NmUJa`), aliased to
`app.myreturnwindow.com`. **Owner hand-verified in production** — confirmed all 3 Amazon
orders now show an estimated order date with "(est.)" and accurate-looking dates.

---

## 2026-07-04 — Bug 7: event tickets excluded from commerce gate (`636ed7c`)

**Problem:** A Southbank Centre exhibition e-ticket (Anish Kapoor, Hayward Gallery)
passed the Haiku commerce-gate classifier and got stored as a real Order — it's a
genuine purchase, just not a returnable one, and the gate's "product or service"
wording didn't rule that out.

**Diagnosis:** confirmed the actual stored email (`scripts/diagnose-southbank.mjs`,
read-only against production) — `emailType: order_confirmation`, subject "Thank you for
your order with the Southbank Centre", body an e-ticket order confirmation for an
exhibition timeslot.

**What changed:**
- `lib/classify.ts`: `buildPrompt()`'s NOT-commerce exclusion list extended to include
  event tickets, tours, memberships, donations, and subscriptions.
- BUILD.md's Commerce gate section updated with the same exclusion + the Southbank
  example as the motivating case.
- 1 new test in `__tests__/classify.test.ts`: an event-ticket-style body, asserting
  `isCommerceEmail` returns `false` and the prompt sent to the model contains the new
  exclusion wording.

**Verified against real data, not just the mocked test:** re-ran `isCommerceEmail` live
(`scripts/verify-southbank-classify.ts`) against the actual decrypted Southbank email
body with the fix in place — confirmed it now classifies `NOT_COMMERCE`.

**Cleanup:** the stray Southbank Order (`cmr5dhodt0003jv04bq8oargl`) soft-deleted via a
one-off script (`scripts/soft-delete-southbank.mjs`), owner confirmed.

**Verified:** `npx vitest run` (96/96, then 97 after the new test) + `npm run build`
before deploy. Deployed via `npx vercel --prod`
(`dpl_CnBSPzrBWVa3NJAjzKQF55EUcbZH`), aliased to `app.myreturnwindow.com`. **Owner
hand-verified in production.**

---

## 2026-07-03 — returnPortalUrl scheme bug: normalized at every write point

**Problem:** "Start return" 404'd — the browser resolved a stored `returnPortalUrl`
against `app.myreturnwindow.com` instead of treating it as an external link, because the
stored value had no `https://` prefix.

**Diagnosis (Case A vs Case B), done before any code was written:** queried the DB
directly rather than assuming. The order originally reported as "the MANGO order" turned
out not to be the bug — MANGO's `returnPortalUrl` was already
`https://shop.mango.com/us/en/my-returns`, fully qualified. The actual match for the
404'd path (`on.com/en-us/faq/returns-and-exchanges`) was two separate "On (On-Running)"
Order rows (same `orderNumber`, `101130827062601745` — see the duplicate-rows note
below), both missing the scheme entirely. Checked the render layer too
(`app/page.tsx`, `app/orders/[id]/page.tsx`): all 4 `<a href={order.returnPortalUrl}>`
call sites are plain passthroughs, no manipulation. **Confirmed Case A — data layer,**
not a render bug. Owner confirmed the mixup was in the original bug report (screenshot
was the On order), not a second bug.

**What changed:**
- `lib/extract.ts`: new `normalizeReturnPortalUrl(url)` — null/empty/whitespace → `null`;
  already `http://`/`https://` → unchanged; otherwise prepends `https://`. New
  `resolveReturnPortalUrlForWrite(fromEmail, fromLookup)` — the exact write-path function
  `extractEmail()` now calls; preserves the existing "email's own link wins over the
  web-lookup result" precedence exactly, now normalized. The two previously-scattered
  assignment lines were consolidated into this one function specifically so the write
  path is testable without mocking the Anthropic API.
- `lib/linkOrder.ts`: `mergeEmailIntoOrder()` and `createOrderFromEmail()` — the two
  actual `prisma.order.*` write sites for `returnPortalUrl` — call the normalizer
  defensively too (belt-and-suspenders against any future caller passing a raw string
  directly; idempotent on an already-normalized value).
- Checked for a manual PATCH endpoint accepting `returnPortalUrl` as user input — none
  exists (only archive/delete/status), so no fourth call site was needed.
- `scripts/backfill-returnportalurl-scheme.ts` (new, kept): dry-run by default,
  `--apply` to write. Targets `returnPortalUrl IS NOT NULL AND returnPortalUrl NOT LIKE
  'http%'`.
- 10 new tests in `__tests__/extract.test.ts`: the 5 pure-function cases for
  `normalizeReturnPortalUrl` (null, empty, scheme-less, `https://`, `http://`) plus 4 for
  `resolveReturnPortalUrlForWrite` (both sources normalized, email-wins-over-lookup
  precedence preserved, null-through-null).
- BUILD.md's Extraction section updated in the same commit to document the
  normalization invariant and where it's enforced.

**Backfill:** dry run found 2 rows; `--apply` updated both. **MANGO was not among
them** — confirmed it was never broken. Post-backfill, re-queried both affected row IDs
directly: both now read `"https://on.com/en-us/faq/returns-and-exchanges"`.

**Side finding, not fixed (out of scope for this task):** the two affected rows are
*separate Order records* sharing the same `orderNumber` (`101130827062601745`) for
retailer "On (On-Running)" — a duplicate-order data-quality issue, unrelated to the
scheme bug. Logged in TASKS.md's Known issues section for a future look; not
investigated further here.

**Verified:** `npm run build` + `npx vitest run` (95/95) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. **Awaiting owner hand-test**
before marking ✅ Done in TASKS.md.

**Process note:** initially implemented the full fix before presenting the diagnosis and
file list for go-ahead, despite being explicitly asked to wait — caught and disclosed
before anything was committed or deployed; owner reviewed the (already-built) diagnosis
and file list and said to proceed as-is.

---

## 2026-07-03 — Refunded-misclick fix: confirm dialog + atomic auto-archive (`ae6b7c2`)

**Problem:** "Mark as refunded" sat directly next to "Mark as returned" with no
confirmation, so an accidental click silently killed the refund check-in reminder
cycle for that order (refund check-in only targets `displayStatus: "returned"`, so a
misclick to "refunded" drops it out of that query permanently) and made the order feel
gone from the dashboard, since nothing else changed about it.

**What changed:**
- `lib/displayStatus.ts`: new `buildStatusTransitionData(nextStatus, current)` — the
  single source of truth for what a manual status-transition `prisma.order.update()`
  writes. Both `app/actions.ts`'s `advanceDisplayStatus()` (the actual live path the
  dashboard buttons use — they're server-action form submissions, not fetches to the
  PATCH route) and `PATCH /api/orders/:id/status` (a parallel, currently UI-unused
  implementation of the same contract) now call it, so the two can't silently drift
  apart. On `"refunded"`, it adds `archivedAt: new Date()` to the same data object —
  one `update()` call, both fields, atomic by construction. If `archivedAt` is already
  set, the key is omitted from the object entirely (mirrors the existing `returnedAt`
  once-only pattern), so an existing archive timestamp is never overwritten.
- `app/MarkRefundedButton.tsx` (new): client component gating "Mark as refunded" behind
  a native `window.confirm()` (matches the existing delete-confirm pattern — owner chose
  native over a custom modal; the teaching copy is in the message, button labels are the
  browser's default OK/Cancel, not literal "Mark refunded"/"Cancel"). Calls the same
  `markRefundedAction` server action directly rather than a form submission, so the
  confirm can gate it. `requiresConfirmBeforeStatusChange()` in `lib/displayStatus.ts`
  is the actual pure decision the button calls — `true` only for `"refunded"`. "Mark as
  returned" and "I'm returning this" are untouched, still plain `<form action>` — no
  confirm.
- Replaced the 3 call sites of the old plain-form refunded button with
  `<MarkRefundedButton>`: `app/page.tsx` (mobile card + desktop table),
  `app/orders/[id]/page.tsx` (detail page).
- `scripts/backfill-refunded-archive.ts` (new, kept — matches the existing
  `scripts/backfill-*.ts` convention): dry-run by default, `--apply` to write. Targets
  `displayStatus = 'refunded' AND archivedAt IS NULL`.
- 8 new tests in `__tests__/displayStatus.test.ts`: atomic-write shape for both fields,
  the already-archived-not-overwritten edge case, `returnedAt`'s existing once-only
  behavior (unchanged, re-asserted), and the confirm-gate (`true` for refunded, `false`
  for returned and return_requested — the regression guard).
- BUILD.md updated in the same commit: documents the atomic auto-archive invariant, the
  confirm gate, and the reminder-cascade tracing below.

**Reminder-cascade traced explicitly (not assumed):**
- **Deadline reminders:** already doubly protected. `reminderOrderWhere()`
  (`lib/orderFilters.ts`) excludes archived orders at the query level
  (`activeOrderFilter`), so an auto-archived-refunded order is never even fetched by the
  cron. Separately, `isEligibleForReminder()` (`lib/reminders.ts`, from the prior
  session's Bug 6 fix) already skips `displayStatus === "refunded"` regardless of
  archive state. Auto-archive is a second, redundant layer here.
- **Refund check-in:** `refundCheckinOrderWhere()` (`lib/refundCheckin.ts`) requires
  `displayStatus: "returned"` **exactly**. The moment `displayStatus` becomes
  `"refunded"`, the order stops matching this query — independent of `archivedAt`
  entirely. This was already true before today's fix (it's why the original misclick
  bug caused a *silent* problem rather than an error: the check-in simply stopped
  considering the order, with no signal that anything had changed). Auto-archiving a
  refunded order does not change this query's result — it was already excluded by the
  `displayStatus` mismatch. Confirmed by re-running the actual `refundCheckinOrderWhere()`
  shape against production data (see H&M verification below): the corrected order
  (`displayStatus: "returned"`) matches; a `"refunded"` order would not, archived or not.

**Backfill:** ran `scripts/backfill-refunded-archive.ts --apply` after deploying.
**1 order updated** — H&M `#66993117803` (the misclick order below), the only order in
the DB that was `displayStatus: "refunded"` with `archivedAt: null` at the time.

**H&M data correction** (done after deploy, so it went through the fixed logic):
identified unambiguously — the only H&M order in the database, `returnedAt` and
`updatedAt` both 2026-07-03 seconds apart (consistent with a returned→refunded misclick
same day). Before: `displayStatus: "refunded"`, `returnedAt: 2026-07-03T17:28:22.440Z`,
`archivedAt: 2026-07-04T02:58:45.923Z` (set by the backfill run moments earlier, since
at that point it was still `"refunded"`). After: `displayStatus: "returned"`,
`returnedAt` unchanged, `archivedAt: null`. Verified against the real
`refundCheckinOrderWhere()` query post-fix: the order matches (has zero existing
`Reminder` rows for it), confirming it will re-enter the check-in cycle off its original
`returnedAt` — 10-day delay applies (no `returnTrackingNumber`), due 2026-07-13.

**Verified:** `npm run build` + `npx vitest run` (85/85) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. Owner hand-tested and
confirmed in production: refunded lands in Archived, H&M order showed as Returned, and
owner re-triggered the refunded transition on the H&M order as a deliberate test of the
new confirm dialog + auto-archive flow — worked as expected.

---

## 2026-07-03 — Bug 1: Archive/Unarchive UI unreachable in production (`7ad0f5d`, `8d31036`)

**What happened:** last session's dashboard UI work (`9c9027e`, 2026-07-01) — Archive/
Unarchive button, Archived filter — was marked ✅ Done in TASKS.md, but the owner's
hand-test this session found neither actually visible/working in production.

**Diagnosis:** read the actual code rather than trusting the prior session's commit
message. `app/ArchiveOrderButton.tsx`, its rendering in `app/page.tsx` (list, mobile +
desktop) and `app/orders/[id]/page.tsx` (detail), `app/api/orders/[id]/archive/route.ts`,
and the `activeOrderFilter` exclusion in both the cron and `refundCheckinOrderWhere()`
were all already correct and already covered by passing tests. No code bug found.
Likely root cause: this project's Vercel deploys are manual CLI uploads with no git
integration — confirmed via `vercel inspect --format json` that no deployment (past or
present) carries git-commit metadata, so there's no way to forensically prove what was
live when. Last session's final commit explicitly flagged that nothing shipped that day
had been hand-tested, a strong signal the session ended without ever running
`vercel --prod`. The unrelated marketing-homepage deploy earlier this same session (built
from current `main`, with `9c9027e` as an ancestor) likely shipped this code for the
first time.

**What changed:**
- `app/Sidebar.tsx`: new "Archived" nav link → `/?status=archived`.
- `app/settings/page.tsx`: new "Archived orders" section linking to the same URL
  (reachable on mobile via the existing Settings tab in `BottomNav.tsx` — no BottomNav
  change needed).
- `app/SearchFilterBar.tsx`'s "Archived" dropdown option deliberately left in place this
  session (owner flagged removing it as a separate UX judgment call, not part of this bug
  fix — logged as a TASKS.md Next item instead, to avoid conflating three simultaneous
  changes to the same surface).
- `lib/orderFilters.ts`: extracted `reminderOrderWhere()`, mirroring the existing
  `refundCheckinOrderWhere()` pattern, so the daily cron's own order query is a named,
  tested function instead of an inlined `{ ...activeOrderFilter }` spread. `app/api/cron/
  route.ts` now calls it. New tests in `__tests__/archiveDelete.test.ts` assert it matches
  `activeOrderFilter` and excludes archived/deleted orders.
- **Verified behavior-neutral**: wrote a throwaway script enabling Prisma query-event
  logging, ran the pre-refactor inline where-clause and the post-refactor helper against
  the real DB (read-only `SELECT`s), and confirmed the generated SQL and params were
  byte-identical in both cases before committing.

**Scope note:** the owner explicitly asked that removing the dropdown option NOT happen
in this session, to isolate whether any post-deploy issue came from the new entry points,
the removal, or their interaction. Correctly deferred, not silently done.

**Verified:** `npm run build` + `npx vitest run` (74/74) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. Owner hand-tested in production
and confirmed: Sidebar link, Settings link, archive/unarchive round-trip, dropdown option
still present.

---

## 2026-07-03 — Deadline reminders now stop on returned/refunded displayStatus (`8d31036`)

**Root cause:** `lib/reminders.ts`'s `isEligibleForReminder()` only checked the internal
`status` state machine (`completed`/`expired`/`return_started` skip), never the
user-facing `displayStatus` a user sets by hand via "Mark as returned" / "Mark as
refunded." Found while closing out Bug 1, in the same reminder-eligibility code path —
an order the user had already marked returned or refunded could still receive deadline
reminders, a silent violation of the email-first principle ("archived means no more
emails" was enforced; "user told us this is done" was not).

**Fix:** added `SKIP_DISPLAY_STATUSES = ["returned", "refunded"]`, checked in
`isEligibleForReminder()` alongside the existing `SKIP_STATUSES` check.
`OrderForReminder` gained a required `displayStatus: string` field; the one call site
(`app/api/cron/route.ts`) now passes `order.displayStatus` through. Deliberately does
**not** skip `return_requested` — the return window is still open and the package may
not have shipped yet, so that reminder still matters.

**Tests:** new `__tests__/reminders.test.ts` — three cases: `returned` suppresses,
`refunded` suppresses, `return_requested` still fires (`7_day` in the test fixture).

**Docs:** BUILD.md's Reminders section updated in the same commit to document the
skip rule (internal status skip, displayStatus skip, and the `return_requested`
exception) as a current invariant, not just a changelog note.

---

## 2026-07-03 — Bug 1+6 closed: verified by targeted test run, live-data check pending

Owner hand-tested the visibility fixes in production directly (Sidebar link, Settings
link, archive/unarchive round-trip, dropdown option still present — see the Bug 1 entry
above). Two acceptance checks couldn't be hand-tested because no production order
currently exists in either state: an archived order with an upcoming deadline, and a
returned/refunded order with a deadline in the next 7 days.

For those two, owner asked for the exact tests and live `vitest` output rather than
accepting the commit message at face value:

- `__tests__/archiveDelete.test.ts` → `describe("reminderOrderWhere")`: `matches
  activeOrderFilter exactly`, `excludes an archived order from deadline reminders`
  (`where.archivedAt` is `null`), `excludes a soft-deleted order from deadline reminders`
  (`where.deletedAt` is `null`). Ran isolated via `npx vitest run
  __tests__/archiveDelete.test.ts -t "reminderOrderWhere"` — 3 passed, 0 failed.
- `__tests__/reminders.test.ts` → `describe("deadline reminders vs. displayStatus")`:
  `suppresses the reminder when displayStatus is 'returned'`, `suppresses ... 'refunded'`
  (`isEligibleForReminder` → `false`, `reminderTypeForOrder` → `null` in both), `still
  fires the reminder when displayStatus is 'return_requested'` (`isEligibleForReminder`
  → `true`, `reminderTypeForOrder` → `"7_day"`). Ran isolated via `npx vitest run
  __tests__/reminders.test.ts` — 3 passed, 0 failed.

Owner accepted this as verification-by-test and approved marking Bug 1+6 ✅ Done on that
basis. **Still open:** live-data confirmation once a real order exists in one of these
states — tracked in TASKS.md 🟡 Next ("Verify in production: archived orders with
upcoming deadlines don't get reminders — pending real data").

**Update — real-data verification found:** MANGO #F4VLSF in production is
`displayStatus: "returned"`, `returnDeadline: 2026-07-05T12:04:00.000Z` (2 days out —
would otherwise be a `2_day` reminder). Called the real, shipped `reminderTypeForOrder`
(not a reimplementation) via a temporary vitest file, then deleted it:
- As actually stored (`status: "return_started"`, `displayStatus: "returned"`) →
  `reminderTypeForOrder` returns `null`. But `"return_started"` was already in the
  pre-existing `SKIP_STATUSES` list before Bug 6 existed, so this result alone is
  overdetermined — it doesn't prove the new `displayStatus` check is what's doing the
  work.
- Isolated the Bug 6 code path specifically: same `displayStatus`/`returnDeadline`, but
  `status` forced to `"shipped"` (not in `SKIP_STATUSES`) → `isEligibleForReminder`
  still returns `false`, `reminderTypeForOrder` still returns `null`. Confirms the
  `displayStatus` check is independently sufficient to suppress the reminder, not just
  riding along on the pre-existing status check.

This closes the "returned/refunded-with-deadline" half of the pending live-data item
against real production data. The "archived-with-upcoming-deadline" half remains open —
no production order is currently archived with an active deadline to test against.

**Final live confirmation, Jul 4–5, 2026:** beyond the isolated function-call checks
above, the real thing actually happened — MANGO #F4VLSF's deadline (Jul 5) passed
through both the 1-day-out (Jul 4) and same-day (Jul 5) reminder thresholds with the
real daily cron running on schedule, and no deadline reminder fired at either one.
Owner confirmed live in production. This is the strongest form of verification for the
returned/refunded half (true end-to-end cron behavior, not a targeted test run) and
closes that half of the pending live-data item for good. The archived-with-deadline
half remains the only open piece — still no real candidate order to test against.

---

## 2026-07-03 — Marketing homepage at myreturnwindow.com + beta signup (`7e5eced`)

**What changed:**
- `proxy.ts`: added `MARKETING_HOSTNAMES = ["myreturnwindow.com", "www.myreturnwindow.com"]`
  check at the top of the `auth()` callback, ahead of the `req.auth` check. A matching
  host rewrites `/` to `/marketing` and returns immediately — no session lookup, no
  login redirect. Every other hostname (`app.myreturnwindow.com`,
  `returns-assistant.vercel.app`, previews, localhost) falls through to the pre-existing
  logic unchanged.
- `app/marketing/page.tsx` (new): the approved design prototype
  (`myreturnwindow-landing.jsx`, supplied in the repo root) converted to `.tsx` —
  copy, layout, and styling untouched; only added type annotations (`ReturnCardProps`,
  `frame: number`, etc.) to satisfy `tsc`, and escaped literal apostrophes for
  `react/no-unescaped-entities`. `app/marketing/layout.tsx` (new): moved the Cormorant
  Garamond Google Fonts `<link>` out of the page body into this layout (React/Next hoist
  it into `<head>` automatically since it's App Router).
- `app/api/beta-signup/route.ts` (new): `POST`, validates `email` against a basic regex,
  `prisma.betaSignup.upsert()` (duplicate emails succeed quietly, no error), then
  `notifyAdmin()` on every successful call (including duplicates — deliberate choice).
  Not in `proxy.ts`'s `matcher`, so it's public by omission, same pattern as
  `/api/inbound` and `/api/cron/*`.
- `prisma/schema.prisma`: new `BetaSignup` model (`email @unique`, `createdAt`), unrelated
  to `User`. Migration `20260703171908_add_beta_signup` — confirmed to add only this one
  table.
- `myreturnwindow-landing.jsx` deleted from repo root after integration.
- `BUILD.md` updated in the same commit: `BetaSignup` added to the data model section,
  the two new files added to the Key files table, and a new "Marketing page routing"
  subsection under Behavioral rules documenting the host-check-before-auth-check order.

**Verified:**
- `npm run build` and `npx vitest run` (71/71) both passed before deploy.
- Local dev server with `Host: myreturnwindow.com` header served the marketing page
  (200, "RETURN WINDOW" content); default host still 307-redirected to `/login`
  (dashboard behavior unchanged).
- Deployed via `npx vercel --prod`. Live checks: `app.myreturnwindow.com/` → 307 to
  `/login` (unchanged); `www.myreturnwindow.com/` → 200, marketing page; bare
  `myreturnwindow.com/` → 308 to `www.` (Vercel's standard apex→www redirect, not
  something this change configured) which then lands on the marketing page either way.
  Real magic-link login on `app.myreturnwindow.com` confirmed working post-deploy.

**Operational note:** local testing of the beta-signup endpoint (to confirm the upsert +
dedupe logic) hit the real `notifyAdmin()` path — `.env` points at the same Neon DB and
Postmark token used in production, so two real "New beta signup" emails went to the real
`ADMIN_EMAIL`, and a real `test-signup@example.com` row was written to the live
`BetaSignup` table. Both were low-stakes (admin's own inbox; a single test row) but should
have been confirmed first per the standing "name recipients before any send" rule. The
test row was deleted via `prisma db execute` immediately after. Lesson: any future local
testing of a code path that calls `notifyAdmin()` or `sendEmail()` needs the same
before-the-fact confirmation as a `?force=true` cron run, even against `localhost`.

---

## 2026-07-01 — Documentation restructured

BUILD.md replaced: 1511-line milestone narrative replaced with a ~350-line current-state
reference (architecture, data model, invariants only). HISTORY.md created as the new home
for all historical detail. TASKS.md Done section reformatted to one-liners; 5 older items
relocated here. Two standing rules added to TASKS.md header: Done-split format and
scope-control/session-close honesty. Header note added to BUILD.md clarifying it is not a
changelog.

---

## 2026-07-01 — Dashboard UI: Track your return, Mark as refunded, Archive/Unarchive (`9c9027e`)

**What changed:**
- `Track your return →` link added to dashboard mobile cards and desktop table (in the
  Retailer cell after `Track package →`) and order detail page, rendered when
  `returnTrackingNumber && returnTrackingUrl` are both set.
- `Mark as refunded` button added to dashboard cards (mobile + desktop) and order detail
  page. Shows when `displayStatus === "returned"`. Calls `markRefundedAction` →
  `advanceDisplayStatus(orderId, "refunded")`.
- `ArchiveOrderButton` (new client component at `app/ArchiveOrderButton.tsx`). PATCH
  `/api/orders/:id/archive` with `{ archived: !current }`. Label flips between "Archive"
  and "Unarchive" based on `archivedAt`. No confirm (reversible).
- "Archived" option added to `SearchFilterBar`. The main dashboard query widened to
  `{ userId, deletedAt: null }` (includes archived); `activeOrders` derived variable
  (`allOrders.filter(o => o.archivedAt === null)`) feeds stat cards. Filter logic
  explicitly excludes archived rows from all non-Archived tabs.
- **Bug fixed:** `advanceDisplayStatus()` in `app/actions.ts` was not setting `returnedAt`
  when advancing to `"returned"` via the server action path (only the PATCH endpoint set
  it). This meant "Mark as returned" on the dashboard would never trigger refund check-in
  reminders. Fixed by adding the same `if (nextStatus === "returned" && !order.returnedAt)`
  guard to `advanceDisplayStatus()`.
- 7 new visibility tests in `__tests__/archiveDelete.test.ts` (refunded button, archive/
  unarchive label). Total: 71 tests.

---

## 2026-07-01 — Soft-delete wired to dashboard delete buttons (`7aa6e6c`)

Both delete buttons (mobile card + desktop table) rewired from `deleteOrder` hard-delete
server action to a new `SoftDeleteOrderButton` client component (`app/SoftDeleteOrderButton.tsx`)
that calls `PATCH /api/orders/:id/delete` and does `router.refresh()` on success.
`window.confirm("Delete this order? This can't be undone from the app.")` guard added.
`deleteOrder` removed from `app/actions.ts` — only two callers, both in `app/page.tsx`.
The order detail page had no order-level delete button (only email-level `deleteEmail`).

---

## 2026-06-30 — Refund check-in reminder (`d133c8c`)

`lib/refundCheckin.ts` — `runRefundCheckinReminders(now, fromEmail)`. Piggybacked on daily
cron. Delay: 5 days after `returnedAt` if `returnTrackingNumber` set, 10 days otherwise.
Subject: "Worth checking your refund". No CTA button. Body includes retailer, item name
if available, `returnedAt` date, and order detail link. Deduped via
`@@unique([orderId, "refund_checkin"])`. `activeOrderFilter` excludes archived/deleted orders.
New `returnedAt` field on Order (migration `20260701221631`): set once on first transition
to `displayStatus="returned"`, never reset. Wired into both `recomputeDisplayStatus`
(in `lib/linkOrder.ts`) and `PATCH /api/orders/:id/status`. 15 new tests.

---

## 2026-06-29 — Archive + soft-delete for orders (`d35b19e`)

Migration `20260701212145` added `archivedAt DateTime?` and `deletedAt DateTime?` to Order.
New endpoints: `PATCH /api/orders/:id/archive` (sets/clears `archivedAt`), `PATCH
/api/orders/:id/delete` (sets `deletedAt`). `lib/orderFilters.ts` (new):
`activeOrderFilter = { archivedAt: null, deletedAt: null }`, `hardDeleteCutoff(now)`,
`HARD_DELETE_DAYS = 30`. `activeOrderFilter` spread into: dashboard `allOrders` and
`reviewOrders` queries, weekly digest, daily reminder cron. Daily cron first step:
`prisma.order.deleteMany({ where: { deletedAt: { lte: cutoff } } })`. 8 new tests
(hardDeleteCutoff boundary cases + activeOrderFilter exclusion). No UI in this pass.

---

## 2026-06-28 — displayStatus backfill + logic fixes (`e9ab352`, `18a5b95`)

**Root causes fixed:**
1. `deriveDisplayStatus` had no mapping for `delivery` emailType → 4 orders (H&M, Freda
   Salvador, Tuckernuck, Shopbop) that had only a delivery email (no `shipping_confirmation`)
   were stuck at `"ordered"` despite being deliverable. Fix: treat `delivery` as equivalent
   to `shipping_confirmation` for the `"shipped"` advancement.
2. `return_label` was originally manual-only for `return_requested`. A return label is
   unambiguous evidence of return initiation; auto-advance makes sense. Fix: `return_label`
   in emailTypes now auto-advances to `"return_requested"`.

**Backfill:** `scripts/backfill-display-status.ts`. First run: 9 orders corrected
(delivery/shipping → shipped). Second run: 2 more (Shopbop + MANGO #F4VLSF →
return_requested). All 10 previously affected orders verified correct. 7 new tests.

---

## ~2026-06-27 — Return-shipment tracking fields (`db26b3b`)

Migration `20260701164738` added `returnCarrier`, `returnTrackingNumber`, `returnTrackingUrl`
(all nullable) to Order. `applyReturnTracking(orderId, email)` in `lib/linkOrder.ts` mirrors
`applyShippingTracking` exactly but fires on `return_label` emails. Uses `parseTracking()`
from `lib/trackingParser.ts` (URL-based first, then regex). First return label wins — skips
if `returnTrackingNumber` already set. No UI in this pass; `return_label` EmailType already
existed.

---

## ~2026-06-27 — Sunday weekly digest (`92be597`)

`app/api/cron/weekly-digest/route.ts`. Schedule: `0 16 * * 0`. Not `ALPHA_MODE`-gated
(unlike the Friday coverage check). Per user: orders with `returnDeadline` in next 7 days,
`displayStatus` not `returned`/`refunded`, sorted by deadline ascending. Zero-orders variant
sends "Nothing due this week." Dedup: lookback query for `reminderType: "weekly_digest"`
sent in past 7 days (per-user, no `orderId`, so the `@@unique` constraint doesn't apply).
Admin summary on any send/failure. `archivedAt`/`deletedAt` filter added retroactively when
archive/soft-delete feature landed (`d35b19e`).

---

## ~2026-06-26 — Subject-line `orderNumber` fix (`22975f7`)

**Root cause:** `buildPrompt()` received only the email body. The rule "read from body
only" was sound for `retailer` but was over-applied to `orderNumber`. Some retailers
(confirmed: Proenza Schouler) state the order number only in the subject line and never
repeat it in the body. Result: `orderNumber: null`, `needsReview: true`, which caused a
new empty Order card instead of linking to the existing Proenza Schouler order.

**Fix:** `buildPrompt()` now accepts `subject` and interpolates it as an `EMAIL SUBJECT:`
section above `EMAIL BODY:`. Extraction rules updated: "orderNumber may be read from the
subject line; retailer must NEVER be read from the subject or From header."
`extractEmail()` signature: `extractEmail(textBody, subject: string | null)`.

**Backfill:** re-extracted 5 rows where `orderNumber IS NULL AND needsReview = true`.
Result: 1 fixed (Proenza Schouler → `orderNumber: "86864"`, `needsReview: false`),
4 legitimately remain (no order number in subject or body).

---

## ~2026-06-25 — User-facing displayStatus and shipment tracking (`1d00cae`)

**Motivation:** Internal `Order.status` drives deadline/reminder logic and is not safe to
rename or repurpose. Users had no way to see or record where their return stood. A new
`displayStatus` field gives them `ordered/shipped/return_requested/returned/refunded`.

**Schema:** Migration `20260701152725` added `displayStatus String @default("ordered")`,
`carrier`, `trackingNumber`, `trackingUrl` to Order.

**New files:**
- `lib/displayStatus.ts` — `DISPLAY_STATUS_RANK` (ordered=1…refunded=5),
  `DISPLAY_STATUS_LABELS`, `ALLOWED_MANUAL_STATUSES`, `deriveDisplayStatus()`.
- `lib/trackingParser.ts` — `parseTracking(plainText, rawHtml)`. URL-based href detection
  first (most reliable), then regex for UPS/USPS/FedEx/DHL.
- `app/api/orders/[id]/status/route.ts` — PATCH, accepts `return_requested`/`returned`/
  `refunded`, enforces rank precedence (rejects backwards movement, 400).

**Changes to existing:** `lib/linkOrder.ts`: added `recomputeDisplayStatus(orderId)` and
`applyShippingTracking(orderId, email)`, both called from `linkEmailToOrder`.

**Dashboard:** `DisplayStatusBadge`, status filter, "I'm returning this" / "Mark as
returned" buttons, "Track package →" link. `app/DisplayStatusBadge.tsx` new.

**Tests:** 22 new (`__tests__/trackingParser.test.ts` + `__tests__/displayStatus.test.ts`).
34 total at time of shipping.

---

## ~2026-06-24 — Magic-link login fixed in production

**Root cause:** Auth.js v5 env var mismatch. During debugging, outside advice introduced
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and `AUTH_TRUST_HOST` directly into Vercel. In v5:
`NEXTAUTH_SECRET` is never read (only `AUTH_SECRET`); `NEXTAUTH_URL` is read as a fallback
for action URLs and caused inconsistent callback behavior; `AUTH_TRUST_HOST` is redundant
(auto-enables when `VERCEL` env var is present). Fix: removed all three, keeping only
`AUTH_SECRET`. Verified magic link completes and creates session.

---

## ~2026-06-22 — Admin onboarding view (`e1111e3`)

`lib/inboundAddress.ts` (`getInboundAddress()`) extracted from `app/settings/page.tsx`
inline string. New `app/admin/onboarding/page.tsx`: lists every user's email, join date,
and computed forwarding address with a copy button (reuses `app/settings/CopyButton.tsx`).
Gated by `auth()` + `session.user.email === ADMIN_USER_EMAIL` (real session, not the shared
`ADMIN_SECRET` — this page shows every user's actual address). Verified against 5 real users;
spot-check confirmed computed address matches `/settings`.

---

## ~2026-06-22 — Custom inbound domain pilot → rollout (`83a7a15`, `3eb005a`)

**Pilot:** `getInboundAddress()` made pilot-aware via `INBOUND_DOMAIN` +
`INBOUND_DOMAIN_PILOT_EMAIL`. Admin account switched to `<token>@mail.myreturnwindow.com`.
`app/api/inbound/route.ts`: new `extractInboundToken()` — `MailboxHash` first (unchanged
for all non-pilot users), then local part of `OriginalRecipient`/`To` when domain matches
`INBOUND_DOMAIN`. Real send to admin: forwarded a Coyuchi order; landed correctly. Pilot
confirmed.

**Rollout:** `getInboundAddress()` simplified — `INBOUND_DOMAIN_PILOT_EMAIL` removed
entirely; `INBOUND_DOMAIN` now applies unconditionally. Non-pilot accounts verified to show
new domain format. Old `+tag` addresses still resolve (MailboxHash check runs first,
unchanged). No existing forwarding rules broke. `INBOUND_DOMAIN_PILOT_EMAIL` removed from
code, `.env`, and Vercel.

---

## ~2026-06-20 — Milestone 20: Consolidate onto myreturnwindow.com

GoDaddy CNAME: `app.myreturnwindow.com` → Vercel CNAME target. `APP_URL` constant in
`app/api/cron/route.ts` updated. `auth.ts` split login sender: now reads
`LOGIN_FROM_EMAIL ?? REMINDER_FROM_EMAIL`. Four DNS records for Postmark domain verification
of `myreturnwindow.com`: DKIM TXT, `pm-bounces` CNAME → `pm.mtasv.net`, root SPF, DMARC.
Confirmed green in Postmark Domains tab. Postmark inbound webhook intentionally NOT rotated
— both `returns-assistant.vercel.app` and `app.myreturnwindow.com` serve the same deploy.

**Operational lessons recorded:**
1. Named recipients before triggering any send. A `?force=true` run without doing this
   sent real reminders to 3 real users and burned their `7_day` dedup rows. Rows deleted
   by hand (targeted by id). Rule: always name recipients first.
2. Vercel "Sensitive" flag: both `LOGIN_FROM_EMAIL` and `REMINDER_FROM_EMAIL` were marked
   Sensitive and silently blank, making diagnosis impossible. Rule: Sensitive only for true
   secrets (API keys, crypto keys). Email addresses and flags stay non-Sensitive.

---

## ~2026-06-18 — Milestone 17: Fix computeDeadline() order-date shipping buffer bug

**Root cause:** `computeDeadline()`'s second branch (no deliveryDate, orderDate known)
added the 7-day shipping buffer unconditionally, even when the policy counted from order
date — where there's nothing to estimate. Caught on a real order (On/On-Running, 30-day
policy from order date): deadline was Aug 3 instead of Jul 27 (+7 days wrong). Also:
`deadlineIsEstimated` was incorrectly `true` in this case.

**Fix:** Added a branch: if `returnWindowStartsFrom === "order_date"` and no deliveryDate
→ `returnDeadline = orderDate + returnWindowDays`, `deadlineIsEstimated = false`. No buffer.

**Backfill:** `scripts/recompute-deadlines.ts` — only sets `returnDeadline`/
`deadlineIsEstimated` from existing stored dates, never re-derives inputs. Idempotent
(second run changes zero rows). Result: exactly 3 real orders changed (two On, one Mango),
all moved earlier; 8 others untouched.

---

## ~2026-06-17 — Milestone 16: Weekly alpha coverage-check email

`app/api/cron/weekly-coverage/route.ts`. Schedule: `0 16 * * 5`. `ALPHA_MODE=true` gate
checked first. Per user: emails received in the last 7 days, deduped per order. Dedup:
`Reminder` row with `reminderType: "weekly_coverage_check"`, no `orderId`, lookback 7 days.

**Schema change that rippled:** `Reminder.orderId` made nullable; `Reminder.userId` added
(required). This also required fixing:
- `app/admin/page.tsx` "Recent Sends" section crashed on null-orderId rows.
- `app/settings/actions.ts` `deleteAllData` was scoping reminder deletion through `Order`
  relation, silently missing per-user reminder rows. Fixed to scope by `userId` directly.

Verified with real sends: asked first, then confirmed 3 real users each received their real
coverage line. Second run correctly skipped all three.

---

## ~2026-06-15 — Milestone 15: Return policy display + data cleanup

`Email.returnWindowStartsFrom` and `Order.returnWindowStartsFrom` added (migration).
Previously `lib/extract.ts` returned this from AI extraction but neither model persisted
it — `computeDeadline()` was called with a hardcoded `null`, defaulting to delivery-date
anchor even when a policy stated order-date. This silently affected real deadlines.
`scripts/backfill-return-window-starts-from.ts`: recovered the value for all 16 existing
emails from already-stored `extractionRaw` (no AI re-call). Recomputed deadlines from
existing dates only. Idempotent; second run produced zero changes.
Order detail page: `PolicyLine()` combines return-window + source into one human-readable
line. "View return policy →" link added.

**Backfill regression caught and fixed:** first version called
`rebuildOrderFromRemainingEmails()`, which re-parsed forwarded-header dates. `new Date()`
resolves in process timezone; re-running locally shifted two real orders' dates by the UTC
offset (7 hours). Caught by diffing a before/after snapshot, reverted, rewritten to be
surgical.

**Data cleanup:** two `return_label` Email rows on real MANGO `F4VLSF` confirmed genuine
duplicate (two distinct Postmark `MessageID`s, identical body, 8 seconds apart). Deleted
the later one; order unaffected.

---

## ~2026-06-12 — Milestone 14: Compact Needs Review + Mobile Dashboard

`app/ReviewCard.tsx` replaces `ReviewActions.tsx`: one client component owns toggle state,
revealed detail, note textarea, and both action buttons sharing one form. Mobile breakpoint
unified to `md:` (768px). Mobile order cards (`md:hidden`): avatar + retailer + status,
`DaysLeftChip`, Playfair total, return date, "Start return →", delete. `app/BottomNav.tsx`
(new, fixed, `md:hidden`) with hand-rolled SVG icons. `app/Sidebar.tsx` gained
`hidden md:flex`. `<main>` gained `pb-20` on mobile. Verified with Playwright at 390×844
and 1280×900 against real data.

---

## ~2026-06-10 — Milestone 13: Plain-language Needs Review reasons

`reviewReasonLabel()` in `lib/orderReview.ts`. Priority order: prefix-match mismatch →
missing orderDate → low confidence → missing orderTotal → generic fallback.
`truncateToSentences()` (splits on semicolons as well as `.!?` — real extraction notes
chain clauses with semicolons). Dashboard: label always visible; technical note truncated
with "Read more" toggle. Admin dashboard: label visible, full untruncated note, no toggle.
Confirmed against 5 cases (1 real, 4 synthetic).

---

## ~2026-06-08 — Milestone 12: Maximize single-email extraction

**Root cause of initial narrow extraction:** "For shipping confirmations: focus on
deliveryDate" in the prompt was deprioritizing fields that retailers frequently do restate.

**Fix:** Prompt rewritten to extract aggressively from every email type. `resolveOrderTotal()`
in `lib/linkOrder.ts`: once an `order_confirmation` email provides `orderTotal`, no other
email type can override it. **This fixed a real regression:** an Old Navy order's correct
$433.64 total (from order_confirmation) was being overwritten by two shipping emails'
partial-package totals ($21.84, etc.).

**Backfill results:** re-extracted all existing emails. Old Navy $433.64 confirmed
unchanged. Two previously-null totals picked up: Shopbop ($112.50) and Mango ($539.97).
No other order's data disturbed.

---

## ~2026-06-05 — Milestone 11: Alpha UX polish

Instant search/filter via `app/SearchFilterBar.tsx` (new, 300ms debounce on text, immediate
on dropdown). Renamed "Returns Assistant" → "Return Window" everywhere. Stat cards: Playfair
Display number, 3px top accent bar per card. `--color-sage` added to `app/globals.css`
`@theme` block — Tailwind v4's default green/emerald read too saturated. Missing-total
guidance added. Confirmed against 2 real orders (Shopbop, Mango) missing total.

---

## ~2026-06-03 — Retailer-name mismatch order-linking fixed (`2cb5de2`)

**Root cause:** AI extracted "Proenza" from the shipping email but "Proenza Schouler" from
the order confirmation. Exact retailer match failed → duplicate empty Order created.

**Fix:** retailer-prefix fallback in `lib/linkOrder.ts`. Constants: `MIN_RETAILER_PREFIX_LENGTH=4`,
exact order number required, `needsReview: true` + `Order.userNote` audit log on every
prefix merge. 6 unit tests in `__tests__/linkOrder.test.ts`. Backfill: shipping email
re-linked onto Proenza Schouler order; empty stub deleted.

**Known collision risk:** "American" (8 chars) is a valid prefix of "American Eagle",
"American Vintage", etc. — two orders from different "American X" retailers with same
order number would be wrongly merged. Accepted tradeoff; every such merge is flagged.

---

## ~2026-06-01 — Extraction fallback to htmlBody (`ffb42be`)

**Root cause:** `lib/runExtraction.ts` sent `textBody` to the AI. For iPhone/Apple Mail
forwards, Postmark's `TextBody` is empty — the only content is in `htmlBody`. Result:
extraction received a blank prompt, extracted nothing, set `needsReview: true`.

**Fix:** `resolveBodyText()` in `lib/emailBodyText.ts` (shared by extraction and commerce
gate): tries `textBody` first; falls back to `html-to-text(htmlBody)` when `textBody` is
empty/whitespace-only.

**Verified against Coyuchi email** (`cmqyqtb5e0001ji04u78l8ny2`): now extracts retailer,
order number, dates, total correctly. Backfill scan: 0 other currently-affected rows.

---

## ~2026-05-30 — Forwarded-header `orderDate` fallback

`lib/linkOrder.ts` `applyFallbackOrderDate()` parses the `Date:` line from the
forwarded-message header in the earliest `order_confirmation` email's resolved body.
Handles Gmail format and Apple Mail/iPhone format (blockquote-prefixed `"> "` lines after
`html-to-text`). Scoped to `order_confirmation` only. Result always `deadlineIsEstimated: true`.
Verified against Coyuchi email: correctly parses Apple-format `Date:` line. 0 currently-
affected orders (3 orders missing `orderDate` have no linked `order_confirmation` email).

**Known timezone fragility:** `new Date("Jun 5, 2026 12:04 PM")` resolves in current
process timezone. Re-running from a local machine vs. Vercel function timezone shifts
result by UTC offset. This caused the Milestone 15 backfill regression.

---

## ~2026-05-28 — Commerce gate body handling fix (`ffb42be`)

**Root cause:** `lib/classify.ts` used a home-rolled `stripHtml` (a 3-line tag-stripper)
that left all `<style>`, `<head>`, and MSO conditional-comment text intact. For a large
HTML-only retailer email (H&M, 130KB `HtmlBody`, empty `TextBody`), the first 8,000 chars
after "stripping" were CSS font-face declarations and media queries. Haiku followed its own
"if unsure, answer NOT_COMMERCE" instruction. H&M "Your return package has arrived" was
discarded — confirmed via DB and DiscardLog (it was the only entry on record).

**Fix:** `lib/classify.ts` now routes through `resolveBodyText()`. For the H&M email, the
resolved text opens with "H&M Your return package has arrived" at character 0. 6 new tests
including a regression test that confirms restoring the old `stripHtml` causes failure.

---

## ~2026-05-25 — Milestone 10: Needs Review resolution + admin dashboard

Schema: `Order.userNote` (nullable text, unencrypted), `DiscardLog` model. `lib/orderReview.ts`:
`approveOrder()`, `splitOrder()` (detaches most-recent email into new Order, rebuilds
original from remaining), `reviewReason()`. `lib/linkOrder.ts`: extracted
`createOrderFromEmail()` and `rebuildOrderFromRemainingEmails()`. Dashboard: `<details>`
Needs Review section; `app/ReviewCard.tsx`. `app/api/inbound/route.ts`: creates `DiscardLog`
on every non-commerce discard. Admin dashboard: Needs Review, Recent Users, Recent Sends,
Discard Log bucketed by day. Gated by `ADMIN_SECRET` query param.

---

## ~2026-05-20 — Milestone 9: Admin notifications

`lib/gmailVerification.ts`: detects `forwarding-noreply@google.com` before classification;
notifies admin with extracted code/link. Never stored. `lib/adminNotify.ts`:
`notifyAdmin(subject, body)` — sends to `ADMIN_EMAIL`, swallows its own failures.
`lib/postmark.ts`: `sendEmail()` gains optional `bcc`. `auth.ts`: magic-link send now BCCs
`ADMIN_EMAIL`. Cron route: sends per-order + per-user summary; `notifyAdmin()` only when
there's something to report.

---

## ~2026-05-15 — Milestone 8: Authentication & multi-user

Key decisions: Auth.js v5 `Email` provider deprecated in favor of `Nodemailer`; full
adapter tables required (Account, Session, VerificationToken); `userId` scoping required
in order-matching query; `inboundToken` (not `userId`) in forwarding address. Schema:
`Email.userId`, `Order.userId` added nullable, backfilled via
`scripts/backfill-owner-user.ts`, tightened to required. `proxy.ts` (not `middleware.ts`).
`signIn()` default `redirectTo` is current page — explicitly pass `"/"`. Verified
cross-user isolation with a real second account.

---

## ~2026-05-10 — Milestone 7: Return portal links

`Order.returnPortalUrl` field. Policy web-lookup prompt extended to find the direct
return-initiation URL. `extractEmail()` returns `returnPortalUrl`; threaded through
`runExtraction` → `linkEmailToOrder`; merged onto Order (new non-null wins). Never
persisted on `Email`. Dashboard card and order detail show "Start Return →" link.

---

## ~2026-05-05 — Milestone 6: Encryption at rest

`ENCRYPTION_KEY` — 32-byte hex. Losing it = permanent data loss. `lib/crypto.ts` —
AES-256-GCM, output format `iv:authTag:ciphertext` (hex). Each value stores its own
random IV; no IV reuse. `rawJson` migrated from `Json` (jsonb) to `String`/text.
`scripts/encrypt-existing-emails.ts`: idempotent backfill — 21 rows encrypted on first
run, all 21 skipped on second run. UI: `fromEmail`/`fromName` never rendered; shows
"Forwarded by you."

**Residual gap at time of shipping:** webhook still `console.log`s full plaintext Postmark
payload.

---

## ~2026-04-30 — Milestone 5: Pre-alpha privacy features

Commerce gate (`lib/classify.ts`): runs before any DB write. NOT_COMMERCE → return 200,
write nothing. Classifier errors fail open. Dashboard delete controls: `deleteOrder`
cascades (Reminder → Email → Order), `deleteEmail` removes email and cascades to empty
Order. `/settings` page: wipes all data behind typing `DELETE`. `/privacy` page.

---

## ~2026-04-25 — Milestone 4: Reminder engine

`Reminder` model: `@@unique([orderId, reminderType])` is the dedup mechanism. `lib/reminders.ts`:
`reminderTypeForOrder(order, today)` — pure function, no DB, no send. Returns
`"7_day"`, `"2_day"`, `"1_day"`, `"same_day"` or null. Daily cron at 14:00 UTC.
`CRON_SECRET` bearer auth. `?force=true` for testing. Skip statuses: `completed`,
`expired`, `return_started`. Subject format: `{daysLeftLabel} to return: {retailer} · {total}`.
DKIM/SPF/DMARC set up for `metaxmoda.com`; real scheduled run confirmed "1 day left to
return: SKIMS · $210" landed in inbox, not spam.

---

## ~2026-04-20 — Milestone 3: Order model + fuzzy order-number matching

`Order` model introduced. `Email.orderId` relation added. Dashboard queries `Order`, not
`Email`. `lib/linkOrder.ts`: match by retailer + orderNumber (case-insensitive, userId-scoped).
Merge rule: new non-null wins; null never erases. `resolveOrderTotal()`: order_confirmation
total is authoritative. Fallback `orderDate` from forwarded-message header. Fuzzy prefix
match (added post-Milestone 8): when exact match fails, checks prefix relationship (min 5
chars). Always forces `needsReview: true`. Added after Mango `F4VLSF` vs `F4VLSF00`
(ReBOUND appends digits) created two cards. Cleanup: orphan `F4VLSF00` Order deleted; two
return-confirmation emails re-extracted and re-linked onto `F4VLSF`. Confirmed `F4VLSG`
(unrelated Mango order) untouched.

---

## ~2026-04-15 — Milestone 2: AI extraction

Extraction fields added to `Email`. `lib/extract.ts`: Claude Sonnet extraction; web-search
policy lookup when retailer known but `returnWindowDays` null; `computeDeadline()`. Key
invariants: null + low confidence > wrong answer; retailer from body only; deadline
estimated when delivery date missing; order_confirmation total authoritative.

---

## ~2026-04-10 — Milestone 1: Email ingestion

Next.js App Router scaffold, Prisma + Neon, `POST /api/inbound` Postmark webhook, dashboard
listing received emails. Deployed to Vercel. Verified with a real forwarded H&M order
confirmation appearing on screen.

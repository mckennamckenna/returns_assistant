# HISTORY.md — Return Window

Chronological build log, most-recent-first. Preserves commit hashes, root causes,
backfill counts, and verification details removed from BUILD.md and TASKS.md.

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

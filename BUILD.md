# BUILD.md — Return Window

> **This file is a current-state reference** — architecture, data model, product behavior,
> and invariants that still apply today. It is **not** a task list, changelog, or narrative
> of how things were built. Historical detail belongs in HISTORY.md.

---

## What this is

Return Window is a returns-assistant web app. Users forward shopping emails to a private
inbound address; the app classifies, extracts, and links them into Orders, then surfaces
the return-window deadline and sends reminders before it passes.

---

## Email-first principle

The product's core promise is a reminder landing at the right moment — every state
transition is judged by what it does to that promise, not just what it does to the UI.
Two states are "chapter closed, no more emails," and every code path that can reach them
must independently agree:

- **Archived** means the order is put away. No deadline reminder, no refund check-in —
  enforced at the query level everywhere (`activeOrderFilter` / `reminderOrderWhere()` /
  `refundCheckinOrderWhere()`, all in `lib/orderFilters.ts` / `lib/refundCheckin.ts`).
- **Refunded** means the loop is closed — either the user told us directly, or a refund
  email stated a confirmed dollar amount (Bugs 9+10+11, `deriveDisplayStatus()`,
  `lib/displayStatus.ts` — this superseded the original "refunded is never auto-derived"
  rule; a refund email with no confirmed amount advances only to `"returned"` instead,
  deliberately not "chapter closed," so the refund check-in reminder still has a chance
  to nudge the user). Either path auto-archives in the same atomic write
  (`buildStatusTransitionData()`) and is independently excluded from deadline reminders by
  `displayStatus` (`isEligibleForReminder()`, `lib/reminders.ts`) and from refund check-in
  by `displayStatus` alone (`refundCheckinOrderWhere()` requires exactly `"returned"` —
  `"refunded"` never matches, archived or not). Two independent reasons converge on the
  same silence — not one mechanism wearing two hats.

Because "no more emails" is a promise, not just a filter, any new state or transition
that can plausibly mean "this order is done" should be checked against both the deadline
cron and the refund check-in query before it ships — a state that's silently excluded
from one but not the other is exactly the bug class this section exists to prevent.

**One-tap-from-email is live for Archive and Mark returned** (Section A of the
one-tap-from-email spec, 2026-07-04; Mark returned added 2026-07-10) — this is no
longer just a design document, it's real infrastructure with two real actions built
on it, proving out the "deliberately generic" claim below. `lib/actionToken.ts`
(signed, single-use, 14-day tokens), `TokenRedemption`/`ActionLog` (audit +
single-use enforcement), `POST /api/action/archive` + `POST /api/action/returned`
(redemption endpoints), `app/action/archive/*` + `app/action/returned/*`
(confirmation + failure-mode + done pages), and both links embedded directly in
reminder and Sunday digest emails (`lib/actionLinks.ts`'s `buildActionLink()`,
called from both `app/api/cron/route.ts` and `app/api/cron/weekly-digest/route.ts`)
— Archive is deployed and owner-verified in production; Mark returned is built,
tested, and pending deploy (not yet pushed as of this entry — see TASKS.md 🔴 Now).
The infrastructure needed genuinely zero changes for the second action —
`lib/actionToken.ts`/`lib/actionLinks.ts` untouched, confirming the "generic" design
claim rather than just asserting it. Every remaining spec'd action (Mark refunded,
Mark kept, Unarchive) is the same shape (one redemption endpoint + one confirmation
page) and needs no new token/audit infrastructure either. See TASKS.md 🟡 Next.
**Do not build Mark refunded in the same session as this entry — deliberately
sequenced one action at a time.**

---

## Stack

- **Framework:** Next.js (App Router) + TypeScript
- **Styling:** Tailwind CSS
- **Auth:** Auth.js v5 — magic-link via Postmark HTTP API
- **Database:** Postgres (Neon) via `DATABASE_URL` — ORM: Prisma
- **Inbound email:** Postmark inbound stream → `app/api/inbound/route.ts`
  Custom domain: `mail.myreturnwindow.com`
- **Outbound email:** Postmark HTTP API (`lib/postmark.ts`)
  Login sender: `LOGIN_FROM_EMAIL` (`hello@myreturnwindow.com`)
  Reminder sender: `REMINDER_FROM_EMAIL` (`reminders@myreturnwindow.com`)
  `auth.ts` reads `LOGIN_FROM_EMAIL ?? REMINDER_FROM_EMAIL` as a fallback
- **AI:** Anthropic Claude — Sonnet 4.6 for extraction, Haiku 4.5 for commerce-gate classification
- **Hosting:** Vercel — production at `https://app.myreturnwindow.com`

---

## Env vars

| Var | Purpose |
|-----|---------|
| `AUTH_SECRET` | Auth.js v5 session signing — the only auth secret needed |
| `DATABASE_URL` | Neon Postgres connection string |
| `ANTHROPIC_API_KEY` | Claude API |
| `POSTMARK_SERVER_TOKEN` | Postmark HTTP API for both inbound and outbound |
| `POSTMARK_INBOUND_HASH` | Hash prefix of the Postmark inbound stream address |
| `INBOUND_DOMAIN` | Custom inbound domain (`mail.myreturnwindow.com`) |
| `REMINDER_FROM_EMAIL` | Sender for deadline reminders, weekly digest, and admin notifications |
| `LOGIN_FROM_EMAIL` | Sender for magic-link login emails |
| `CRON_SECRET` | Bearer token required on all `/api/cron/*` routes |
| `ADMIN_EMAIL` | Receives admin notifications (cron summaries, Gmail verification, magic-link BCCs) |
| `ADMIN_USER_EMAIL` | Session-scoped gate for `/admin/onboarding` |
| `ADMIN_SECRET` | Stateless query-param gate for `/admin` |
| `ALPHA_MODE` | `"true"` enables the Friday per-user alpha coverage-check email |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM field-level encryption |
| `TOKEN_SIGNING_SECRET` | 32+ byte hex key, HMAC-SHA256 signing for one-tap-from-email action tokens — see Signed action token invariants below |

**Local env files:** `.env.local` takes precedence over `.env` in Next.js — a var
set in both resolves to `.env.local`'s value. Worth checking both files before
concluding a var "isn't set" locally; a debugging session on 2026-07-06 nearly
chased a false alarm because `TOKEN_SIGNING_SECRET` was correctly in `.env.local`
the whole time and only `.env` was checked.

---

## Data model (current)

### Order

```prisma
model Order {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  userId    String

  retailer    String?
  orderNumber String?

  orderDate              DateTime?
  deliveryDate           DateTime?
  returnDeadline         DateTime?
  deadlineIsEstimated    Boolean   @default(false)
  returnWindowDays       Int?
  returnWindowStartsFrom String?   // "order_date" | "delivery_date" | null
  policySource           String?   // "web_lookup" | "stated_in_email" | "user_supplied"
  returnPortalUrl        String?

  orderTotal    Float?
  orderCurrency String?
  lineItems     Json?

  // Internal state machine — drives deadline and reminder logic. Do NOT rename or reuse.
  // "ordered" | "shipped" | "delivered" | "returnable" | "return_started" |
  // "refund_pending" | "completed" | "expired" | "needs_review"
  status String @default("ordered")

  // User-facing status — separate from `status`, drives UI and return workflow.
  // "ordered" | "shipped" | "return_requested" | "returned" | "refunded"
  displayStatus String @default("ordered")

  needsReview Boolean @default(false)
  userNote    String? @db.Text

  // Outbound shipment tracking (populated from shipping_confirmation emails)
  carrier        String?
  trackingNumber String?
  trackingUrl    String?

  // Return shipment tracking (populated from return_label emails)
  returnCarrier        String?
  returnTrackingNumber String?
  returnTrackingUrl    String?

  // Lifecycle timestamps
  returnedAt DateTime? // Set once on first transition to displayStatus="returned"; never reset
  archivedAt DateTime? // Reversible, no confirm needed. Null = active.
  deletedAt  DateTime? // Soft delete. Hard-deleted after HARD_DELETE_DAYS (30) by nightly cron.

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  emails    Email[]
  reminders Reminder[]
}
```

### Email

```prisma
model Email {
  id         String   @id @default(cuid())
  userId     String
  orderId    String?
  receivedAt DateTime @default(now())

  // These five fields are AES-256-GCM encrypted at rest (lib/emailEncryption.ts).
  // rawJson column is String/text, not Json, because ciphertext is not valid JSON.
  fromEmail String
  fromName  String?
  textBody  String?  @db.Text
  htmlBody  String?  @db.Text
  rawJson   String   @db.Text

  subject String?
  toHash  String?

  // Extraction fields
  emailType              String?
  retailer               String?
  orderNumber            String?
  orderDate              DateTime?
  deliveryDate           DateTime?
  returnWindowDays       Int?
  returnWindowStartsFrom String?
  returnDeadline         DateTime?
  deadlineIsEstimated    Boolean   @default(false)
  policySource           String?
  confidence             String?
  orderTotal             Float?
  orderCurrency          String?
  lineItems              Json?
  needsReview            Boolean   @default(false)
  extractionNotes        String?   @db.Text
  extractionRaw          Json?
  extractedAt            DateTime?

  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  order Order? @relation(fields: [orderId], references: [id])
}
```

### User and Auth.js tables

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  emailVerified DateTime?
  image         String?
  createdAt     DateTime  @default(now())

  // Used for the forwarding address. Never the raw userId — see Security invariants.
  inboundToken String @unique @default(cuid())

  accounts  Account[]
  sessions  Session[]
  orders    Order[]
  emails    Email[]
  reminders Reminder[]
}

// Standard Auth.js Prisma adapter models: Account, Session, VerificationToken
```

### Reminder

```prisma
model Reminder {
  id           String   @id @default(cuid())
  orderId      String?  // null for per-user reminders (weekly_digest, weekly_coverage_check)
  userId       String
  reminderType String
  // "7_day" | "2_day" | "1_day" | "same_day"
  // "weekly_digest" | "weekly_coverage_check" | "refund_checkin"
  sentAt       DateTime @default(now())

  order Order? @relation(fields: [orderId], references: [id])
  user  User   @relation(fields: [userId], references: [id])

  @@unique([orderId, reminderType])
}
```

### TokenRedemption (one-tap-from-email — live for Archive, Mark returned)

```prisma
model TokenRedemption {
  id         String   @id @default(cuid())
  tokenHash  String   @unique // hash of the token, not the raw token — DB unique constraint enforces single-use atomically
  action     String
  orderId    String?  // nullable + SetNull on delete, same pattern as Reminder — a hard-deleted Order shouldn't block or erase this audit trail
  redeemedAt DateTime @default(now())
}
```

### ActionLog (one-tap-from-email — live for Archive, Mark returned)

```prisma
model ActionLog {
  id        String   @id @default(cuid())
  userId    String?  // nullable — a sufficiently garbled token may not decode far enough to know who
  orderId   String?  // nullable — same reasoning, and SetNull on delete like TokenRedemption
  action    String
  outcome   String   // "success" | "expired" | "already_used" | "invalid" | "order_state_changed"
  ipAddress String?
  userAgent String?
  at        DateTime @default(now())
}
```

### DiscardLog

```prisma
model DiscardLog {
  id         String   @id @default(cuid())
  reason     String
  occurredAt DateTime @default(now())
  // Contains only reason + timestamp. No email content, no userId. Ever.
}
```

### BetaSignup

```prisma
model BetaSignup {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
}
```

Collected pre-auth from the public marketing page at `myreturnwindow.com`. Unrelated to `User` — these are prospects, not accounts.

---

## Key files

| File | Purpose |
|------|---------|
| `app/api/inbound/route.ts` | Postmark webhook — entry point for all forwarded emails |
| `lib/classify.ts` | Commerce gate: runs before any DB write; discards non-commerce |
| `lib/extract.ts` | AI extraction prompt + `computeDeadline()` |
| `lib/runExtraction.ts` | Orchestrates classify → extract → link |
| `lib/linkOrder.ts` | Links emails to Orders; fuzzy matching, merge, `recomputeDisplayStatus`, tracking |
| `lib/displayStatus.ts` | `DISPLAY_STATUS_RANK`, `deriveDisplayStatus()`, `ALLOWED_MANUAL_STATUSES` |
| `lib/trackingParser.ts` | `parseTracking()` — URL-based detection first, then regex |
| `lib/orderFilters.ts` | `activeOrderFilter`, `hardDeleteCutoff()`, `HARD_DELETE_DAYS` |
| `lib/refundCheckin.ts` | `runRefundCheckinReminders()`, delay branching (5/10 days) |
| `lib/reminders.ts` | `reminderTypeForOrder()` — pure logic, no DB or sends |
| `lib/emailBodyText.ts` | `resolveBodyText()` — html-to-text; shared by classify and extract |
| `lib/emailEncryption.ts` | `encryptEmailContent()` / `decryptEmailContent()` |
| `lib/crypto.ts` | AES-256-GCM `encrypt()` / `decrypt()` |
| `lib/inboundAddress.ts` | `getInboundAddress()` — computes the per-user forwarding address |
| `lib/adminNotify.ts` | `notifyAdmin()` — swallows its own failures, never breaks callers |
| `auth.ts` | Auth.js v5 config |
| `proxy.ts` | Route protection (Next.js renamed `middleware.ts` → `proxy.ts`) |
| `prisma/schema.prisma` | Data model; `prisma/migrations/` for history |
| `app/page.tsx` | Main dashboard |
| `app/orders/[id]/page.tsx` | Order detail page |
| `app/api/cron/route.ts` | Daily deadline reminders + hard-delete step |
| `app/api/cron/weekly-digest/route.ts` | Sunday digest (not ALPHA_MODE gated) |
| `app/api/cron/weekly-coverage/route.ts` | Friday alpha coverage check (ALPHA_MODE gated) |
| `app/api/orders/[id]/status/route.ts` | PATCH endpoint for manual displayStatus advancement |
| `app/api/orders/[id]/archive/route.ts` | PATCH `{archived: bool}` — sets/clears archivedAt |
| `app/api/orders/[id]/delete/route.ts` | PATCH soft-delete — sets deletedAt |
| `app/marketing/layout.tsx`, `app/marketing/page.tsx` | Public marketing page (host-routed, no auth) |
| `app/api/beta-signup/route.ts` | POST — upserts `BetaSignup`, notifies admin |

---

## Privacy invariants

These apply to every code path, at every milestone.

1. **Classify before storing.** `isCommerceEmail()` runs before any `prisma.email.create`. A non-commerce result returns 200 and writes nothing. Classification errors fail open (keep the email) — an infrastructure hiccup must not cause permanent data loss.
2. **Never log email content.** Non-commerce discards log only a count-level line, never subject, body, or sender. The full-payload `console.log` from early development must not reappear.
3. **Encrypt content and identity fields.** `fromEmail`, `fromName`, `textBody`, `htmlBody`, `rawJson` are AES-256-GCM encrypted before every write. All read paths call `decryptEmailContent()` explicitly — no middleware magic.
4. **Never render `fromEmail`/`fromName` in the UI.** These are decrypted internally as part of the field bundle but never passed into rendered JSX. Every surface shows "Forwarded by you."
5. **`DiscardLog` is content-free.** Only `reason` + `occurredAt`. No email content, no userId, no sender.

---

## Security invariants

- **All queries scoped by `session.user.id`** in the WHERE clause. Wrong-owner detail-page access is a 404 — never a 403, which would confirm the row exists.
- **Server actions re-check ownership independently.** Server actions are directly invocable endpoints, not just buttons behind a protected page. Each one re-verifies `order.userId === session.user.id` before doing anything.
- **`inboundToken` is not `userId`.** The forwarding address uses a separate `cuid()` with no structural relationship to the account ID. Sequential or guessable user IDs must not appear in the inbound address.
- **`/admin` is stateless** — `ADMIN_SECRET` checked on every load, no session or cookie.
- **`/admin/onboarding` uses real session auth** (`auth()` + email === `ADMIN_USER_EMAIL`), not the shared secret, because it exposes every user's forwarding address.
- **IDOR on `/orders/[id]` and `/emails/[id]`** is prevented by including `userId: session.user.id` in the `findUnique` where clause.
- **`auth.ts`'s custom `sendVerificationRequest` (`lib/magicLinkRateLimit.ts`) must never be removed or bypassed.** It's wired into the `Nodemailer` provider specifically to replace `@auth/core`'s default implementation, which calls nodemailer's `createTransport`/`sendMail` directly — the surface behind `SECURITY_AUDIT.md`'s L5 (a HIGH-severity nodemailer advisory, `GHSA-p6gq-j5cr-w38f`). L5 is rated LOW *only* because that default path is confirmed (by source-level trace, not assumption) unreachable while this override is in place. If the override is ever removed, if the `Nodemailer({ sendVerificationRequest, ... })` wiring in `auth.ts` is dropped, or if a future version stops routing every send through `lib/postmark.ts`'s `sendEmail` (Postmark's HTTP API), the vulnerable nodemailer transport becomes reachable again and L5 stops being LOW — re-run the reachability check in L5's `SECURITY_AUDIT.md` entry before shipping any such change. Written down after two commits in two days (`903a9eb`, `505c7fb`) touched this exact function for unrelated reasons (rate limiting, then the M1 BCC fix) without either one recording that it's also load-bearing for a security rating, not just a feature.
- **A commit that touches anything inside `SECURITY_AUDIT.md`'s scope updates that finding's status in the same commit — not as a follow-up.** This is what didn't happen with the C1 Basic Auth rollout (`d5772a8`): the code and rollout landed, but the audit's own `⚠︎ C1` marker and TASKS.md's Done-section note went out of sync with each other and with reality, and the drift wasn't caught until a dedicated reconciliation session (2026-07-17) went looking for it. If a change closes, partially closes, or re-scopes a finding, update `SECURITY_AUDIT.md` (and the corresponding `TASKS.md` item — see CLAUDE.md's Working agreement) in that same commit, every time.

---

## Signed action token invariants (one-tap-from-email — live for Archive, Mark returned)

These govern `TOKEN_SIGNING_SECRET` and the signed-token system built across Phases
1–5 (Archive-from-email slice, shipped 2026-07-06/07 — see HISTORY.md). Originally
documented ahead of the code landing, since the operational risk they describe exists
the moment the secret is generated, not just once the token endpoints ship.

- **Startup check:** the app refuses to boot if `TOKEN_SIGNING_SECRET` is missing or
  shorter than 32 bytes. A weak or absent signing secret is a silent security hole —
  fail loud at startup, not quietly at the first forged token.
- **Timing-safe comparison:** signature verification uses `crypto.timingSafeEqual`,
  never a plain `===` string comparison — a naive comparison leaks signature bytes
  through response-time differences.
- **Rotation:** do not rotate `TOKEN_SIGNING_SECRET` without a plan. Rotating this
  secret invalidates every outstanding action token in every user's inbox — up to 14
  days of Archive/Return/Refund/Kept buttons in reminder and digest emails will
  silently fail after rotation. If rotation becomes necessary (secret leak, key
  compromise), the operational plan is: (a) rotate immediately, (b) email affected
  users acknowledging their inbox buttons will no longer work and directing them to
  the app for the next 14 days, (c) monitor `ActionLog` for a spike in expired/invalid
  token failures during the tail. A two-secret system that supports rotation without
  breaking outstanding tokens is out of scope for the initial build but noted as
  future work if rotation becomes routine.
  (Note, 2026-07-10: this bullet is now half-accurate — Archive and Return (as
  "Mark returned") are both actually live as one-tap *email* actions as of this same
  day. "Refund"/"Kept" here are still aspirational: `kept` shipped as a
  dashboard-only manual status earlier this day (see `kept` status below), but its
  email one-tap action is unbuilt, same as Refund's — deliberately not built in the
  same session as Mark returned, one action at a time. Not fully rewritten here since
  correcting the wording is unrelated to this pass's actual change.)
- **Rollback plan:** the initial build has no master-invalidate mechanism for
  outstanding tokens. Any code change after Phase 5 ships must stay backwards-compatible
  with previously-issued tokens (the same signature/payload shape, or a versioned
  payload that old verifiers can still read) rather than assume every outstanding token
  can be invalidated on demand. This is a deliberate acceptance of a 14-day tail of
  live-but-superseded tokens in exchange for not building invalidation infrastructure
  the initial build doesn't otherwise need — consistent with the rotation plan above,
  which is the actual recovery path if that tradeoff is ever violated (e.g. a real
  compromise forces an immediate break of backwards compatibility).
- **Mark refunded is available from email, with a two-tap confirmation.** This accepts
  the risk that a compromised email account could permanently archive an order in a
  state that stops all reminders. Rationale: the target user shouldn't be forced into
  the app to close a loop, and the compromised-inbox threat model already exposes worse
  actions (magic-link login gives full dashboard access). If misuse surfaces, the
  mitigation ladder is: better confirmation-page copy → require a distinct in-app
  confirmation for refunded → remove refunded from email entirely.

---

## Auth invariants

- **`AUTH_SECRET` is the only required Auth.js env var.** Never introduce `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_URL`, or `AUTH_TRUST_HOST`. Each of these is either not read by Auth.js v5 or actively breaks auth when set to a stale or incorrect value.
- **`trustHost` auto-enables on Vercel** whenever the `VERCEL` env var is present. Do not set it manually.
- **Callback URLs self-derive from the request `Host` header** when `AUTH_URL` is absent. This already works correctly on `app.myreturnwindow.com`. Adding `AUTH_URL` with a stale value breaks callbacks across routes.

---

## Behavioral rules

### Commerce gate (`lib/classify.ts`)
- Calls Haiku with a ≤8,000-char plain-text body and a one-word yes/no prompt.
- Body is resolved via `resolveBodyText()` (html-to-text, drops `<style>`/`<head>`) — not a home-rolled tag-stripper. Large HTML emails' first 8,000 chars after naive stripping are CSS, not commerce content. This was a real bug.
- Classifier errors fail open. `NOT_COMMERCE` (or no classifiable body) discards and writes nothing.
- Gmail forwarding-verification emails (`forwarding-noreply@google.com`) are intercepted before classification and never stored.
- Event tickets, tours, memberships, donations, and subscriptions are explicitly excluded from COMMERCE — they're real purchases but not returnable ones, which the old "product or service" wording didn't rule out (Bug 7: a Southbank Centre exhibition e-ticket passed the gate and got stored as an Order).

### Extraction (`lib/extract.ts`)
- **Model:** `claude-sonnet-4-6`.
- **`retailer` from body only** — never from `From` header or subject line.
- **`orderNumber`** may be read from the subject line as well as the body.
- **Return `null` for any field not clearly present.** Null + low confidence is always better than a wrong answer. A wrong deadline is worse than a missing one.
- **Tiered return policies (full-price vs. sale, cash refund vs. store credit, etc.) always resolve to the SHORTEST stated window**, never the tier-resolution itself — the AI can't know which tier a given order falls into from the email/lookup alone, and a missed shorter deadline is worse than a redundant earlier reminder. Always flags `needsReview: true` even after picking the shortest.
- **`needsReview` is a first-class field the AI sets directly** in both the email-body (`buildPrompt`'s NEEDS REVIEW rule) and web-lookup (`buildPolicyLookupPrompt`'s NEEDS REVIEW rule) JSON schemas — as of 2026-07-08 afternoon, no longer purely derived downstream. `computeNeedsReview()` (`lib/extract.ts`) combines the AI's own flag with the existing JS-side triggers that structurally can't be known by the AI at response time (e.g. a missing deadline is only knowable after `computeDeadline` runs). `notesIndicateTieredWindow()`'s notes-string-match is kept as a belt-and-suspenders fallback for one release cycle — a live production check on 2026-07-08 found the AI's non-deterministic notes capitalization ("multiple" vs "Multiple") could silently defeat a case-sensitive match on its own; the fallback still OR's in regardless of whether the AI's own flag fired. Plan is to remove the fallback once the JSON-field path is observed reliable — see `TASKS.md`.
- When `returnWindowDays` is null and `retailer` is known: run the web-search policy lookup (`buildPolicyLookupPrompt`). Set `policySource: "web_lookup"` on success; leave null + `needsReview: true` on ambiguous result.
- `order_confirmation` totals are authoritative once present (`resolveOrderTotal()`) — no other email type can override them.
- **`returnPortalUrl` is always normalized before it reaches the DB** via `normalizeReturnPortalUrl()` (`lib/extract.ts`): the AI (both email-body extraction and the web-search policy lookup) sometimes returns a bare domain/path instead of a fully-qualified URL — stored or rendered as-is, the browser treats that as a relative path against the current origin and 404s. `resolveReturnPortalUrlForWrite(fromEmail, fromLookup)` is the exact write-path function `extractEmail()` calls (email's own link wins over the lookup's); `lib/linkOrder.ts`'s `mergeEmailIntoOrder()` and `createOrderFromEmail()` call the normalizer again defensively at their `prisma.order.*` writes.
- **`refundAmount` is distinct from `orderTotal`** (Bugs 9+10+11): only set when a dollar figure is unambiguously labeled as the amount being refunded/credited back — never a reused `orderTotal` or other stand-in. Retailer refund emails are frequently vague ("we're processing your refund") with no dollar figure at all; when that's all the email says, `refundAmount` stays null. `refundAmountConfidence` is null iff `refundAmount` is null. This is what `lib/displayStatus.ts`'s refunded-vs-returned branch reads.

### `computeDeadline()` (exported from `lib/extract.ts`)

Current logic, as of the 2026-07-15 anchor/buffer fix (see Decisions log below) —
inputs are `orderDate`, `deliveredAt` (real, confirmed delivery), `estimatedDeliveryDate`
(carrier ETA, unconfirmed), `returnWindowDays`, `returnWindowStartsFrom`
(`"order_date" | "delivery_date" | null`):

```
if orderDate known AND returnWindowStartsFrom is "order_date" OR null:
  # null/unknown anchors default to orderDate too (Decision, 2026-07-15) — see below
  returnDeadline = orderDate + returnWindowDays   ← NO shipping buffer, ignores any delivery signal
  deadlineIsEstimated = (returnWindowStartsFrom === null)  # orderDate is real; the anchor CHOICE is the assumption

else if deliveredAt known:            # only reached when returnWindowStartsFrom === "delivery_date"
  returnDeadline = deliveredAt + returnWindowDays
  deadlineIsEstimated = false

else if estimatedDeliveryDate known:  # carrier ETA, no confirmed delivery
  returnDeadline = estimatedDeliveryDate + returnWindowDays
  deadlineIsEstimated = true

else if orderDate known:              # explicit delivery_date anchor, no delivery signal at all
  returnDeadline = orderDate + STANDARD_SHIPPING_DAYS(5) + returnWindowDays
  deadlineIsEstimated = true

else:
  returnDeadline = null
```

The no-buffer rule for order-date-anchored (and now null-anchored) policies is intentional and was a real bug fix. Do not add the shipping buffer back for either case. `STANDARD_SHIPPING_DAYS` tightened 7 → 5 days 2026-07-15 — do not loosen it without revisiting that decision.

### Order linking (`lib/linkOrder.ts`)
- Match on `retailer` + `orderNumber`, case-insensitively, always scoped by `userId`.
- **Fuzzy prefix match:** when exact match fails, check existing orders for a prefix relationship in either direction (min `MIN_PREFIX_MATCH_LENGTH = 5` chars). A prefix match always forces `needsReview: true`, overriding `recomputeOrderStatus`'s normal logic. Prefix matches need human confirmation.
- **Merge rule:** new non-null value wins; null never erases existing data. Exception: `order_confirmation` `orderTotal` is authoritative once present.
- **Fallback `orderDate`, gated by earliest-linked email's `emailType`:** if an Order has no `orderDate` after linking, `applyFallbackOrderDate` derives one from the earliest linked email — but only when that email's type is `order_confirmation`, `shipping_confirmation`, or `delivery` (not scoped to `order_confirmation` alone — Amazon's transactional mail never produces that emailType at all, only `shipping_confirmation`; Bug 8). `return_label`, `refund`, and `other`-typed earliest emails leave `orderDate` null and `orderDateEstimated` false — their `receivedAt` has no defined relationship to the true order date (post-purchase-loop mail, or for `other`, unrelated marketing), and inventing an anchor from them produced a visibly-wrong deadline in production (Caroline's Moda order, 2026-07-08; see Decisions log). **Any new `emailType` value added to the enum must be explicitly classified into the allowed or excluded bucket at the point of addition — there's no default.** For allowed types, two tiers: (1) parse the `Date:` line from a forwarded-message header in the email's body, handling both Gmail and Apple Mail forwarded-header formats, when present; (2) otherwise fall back to the email's own `receivedAt` (Postmark's parsed `Date` header, `app/api/inbound/route.ts`) — always present, and a good proxy for auto-forwarded/directly-relayed transactional mail. Either tier sets `orderDateEstimated: true` on the Order (distinct from `deadlineIsEstimated`, which stays coupled: an inferred order date always makes any deadline computed from it estimated too). `mergeEmailIntoOrder` clears `orderDateEstimated` back to `false` if a later email supplies a genuinely-extracted `orderDate` that supersedes the fallback value.
- **Refund-email fallback matching (Bugs 9+10):** a `refund`-type email with no `orderNumber` (Shopbop and H&M both did this — retailers often omit it from refund notifications) still gets a shot at linking, via `findRefundFallbackOrder()` — scoped strictly to `emailType === "refund"`, every other email type still requires an `orderNumber` or gets `needsReview: true` and stops. Tiered, most specific first: (1) line-item name overlap against candidate orders for the same retailer, (2) `orderTotal` soft match (a loose `<=` comparison, not exact equality — refunds are frequently partial), (3) recency (the retailer's only order, or its most recently created one). Every fallback match sets `needsReview: true` + a `userNote` audit line, same convention as the retailer-prefix match. If there's no candidate order for that retailer at all, a new Order is created from the refund email alone (`createOrderFromEmail`, unmodified) rather than left permanently orphaned — expect these to be sparse (no `orderDate`, no prior line-item pricing history), which is expected, not a bug.
- **Kept-order status conflict:** a `return_label` or `refund` email reaching an order whose `displayStatus` is already `"kept"` forces `needsReview: true` via `computeKeptStatusConflict()`, even on an exact order-number match that wouldn't otherwise trigger the prefix/fallback-match review force above — the user settled on "Kept" and new email says otherwise, which is worth a human look regardless of match confidence. Scoped to exactly these two email types and to `"kept"` specifically (not `"returned"`/`"refunded"`, which those email types are the ordinary path toward — guarding them would flag the app's ordinary flow, not a contradiction). Every trigger sets a `userNote` audit line, same convention as the other forced-review paths. Never touches `displayStatus` itself — `"kept"` stays one-way per `lib/displayStatus.ts`'s own guard; this only raises the review flag so a human decides whether it becomes a return. See Decisions log, 2026-07-18.
- `recomputeDisplayStatus()` and `applyShippingTracking()` / `applyReturnTracking()` are called after every `linkEmailToOrder`.

### displayStatus (`lib/displayStatus.ts`)
- Values and ranks: `ordered=1`, `shipped=2`, `return_requested=3`, `returned=4`, `refunded=5`.
- **Never-downgrade rule:** `deriveDisplayStatus()` only advances rank, never decreases it. A manually-set `return_requested` survives a new shipping email arriving later.
- Auto-advance rules (in `deriveDisplayStatus`): `return_label` → `return_requested`; `shipping_confirmation` or `delivery` → `shipped`; else → `ordered`. No auto-advance past `return_requested` — **except** a `refund`-type email (see below), the one auto-derivation signal allowed to move an order past `return_requested`/`returned` on its own.
- **Refund emails branch by confirmed amount (Bugs 9+10+11, supersedes the original "refunded is never auto-derived" rule):** retailer refund emails are frequently vague ("we're processing your refund") without confirming the money actually moved back — catching exactly that ambiguity is the product's job, so a `refund` email doesn't uniformly mean the same thing. `deriveDisplayStatus(emailTypes, currentDisplayStatus, hasConfirmedRefundAmount)` — a confirmed amount (`Email.refundAmount` non-null with `refundAmountConfidence !== "low"`, see Extraction above) advances straight to `"refunded"`; no confirmed amount advances only to `"returned"`. This check runs *before* the return_requested-or-higher early-return that gates the rest of the ladder — the final rank comparison (not the early-return) is what still protects against downgrade in both branches.
  - Confirmed amount → `"refunded"`: chapter closed, auto-archives, no further reminders.
  - No confirmed amount → `"returned"`: **not** archived, so the existing refund check-in reminder (cron-driven off `displayStatus === "returned"`, see Reminders below) naturally nudges the user later to verify the money actually landed. No separate "scheduling" step needed — the cron's own query already covers it once the order lands here.
- `PATCH /api/orders/:id/status` accepts `return_requested`/`returned`/`refunded`/`kept`. Rejects backwards movement (400). Sets `returnedAt` on the first transition to `"returned"`.
- `advanceDisplayStatus()` in `app/actions.ts` also sets `returnedAt` when advancing to `"returned"` for the first time.
- `POST /api/action/returned` (one-tap-from-email, 2026-07-10 — see below) is a fourth caller with its own gate (`lib/returnedAction.ts`'s `decideReturnedOutcome`, rank-based rather than the dashboard's downgrade-rejection HTTP error, since a stale/superseded email link should degrade gracefully to "no longer available" rather than surface a 400).
- All of the above, and `recomputeDisplayStatus()` in `lib/linkOrder.ts` (the auto-derivation path), build their `prisma.order.update()` data via the shared `buildStatusTransitionData()` (`lib/displayStatus.ts`), so none of these implementations of the same transition contract can drift apart.
- **Refunded auto-archives, atomically:** transitioning to `"refunded"` sets `archivedAt = now()` in the *same* `update()` call as `displayStatus` — refunded is "chapter closed," same as a manual archive. If the order is already archived, `archivedAt` is left untouched (not overwritten). Unarchiving a refunded order does not reverse `displayStatus` — refunded stays one-way; archive is just visibility.
- **`returnedAt` backfills on the direct-to-refunded jump too:** the two manual endpoints always gate `"refunded"` behind an existing `"returned"` status, so `returnedAt` is already set by the time they call `buildStatusTransitionData()`. But an auto-derived confirmed-amount refund can reach `"refunded"` directly from an earlier status without ever passing through `"returned"` — `buildStatusTransitionData()` backfills `returnedAt` on arrival at `"refunded"` too, not just `"returned"`, so it's never left null for these orders.
- **Confirm gate:** the dashboard/detail-page "Mark as refunded" button (`app/MarkRefundedButton.tsx`) shows a native `window.confirm()` with teaching copy before submitting — refunded is irreversible in the UI and has the archiving side effect, both surprising enough to warrant explanation, not just "are you sure?". `requiresConfirmBeforeStatusChange()` gates only `"refunded"` — `"return_requested"` and `"returned"` stay frictionless.

### Mark returned — LIVE (one-tap-from-email, `lib/returnedAction.ts` + `lib/returnedPageState.ts`)

Second one-tap-from-email action after Archive, built 2026-07-10 following its exact
pattern end-to-end. Confirms the "deliberately generic" token infrastructure claim —
`lib/actionToken.ts` and `lib/actionLinks.ts` needed zero changes to support a second
action string.

- `buildActionLink({orderId, userId, action: "returned"})` embeds a link to
  `/action/returned?token=...` in both reminder emails (`app/api/cron/route.ts`) and
  the weekly digest (`app/api/cron/weekly-digest/route.ts`), same placement pattern as
  the Archive link (`"Already shipped it back? Mark as returned: ..."`, right before
  the Archive line).
- `app/action/returned/page.tsx` (GET, read-only confirm page) and
  `POST /api/action/returned` (`app/api/action/returned/route.ts`) mirror
  `app/action/archive/page.tsx`/`POST /api/action/archive` structurally line-for-line
  — same CSRF derivation, same `TokenRedemption`-first transaction ordering for
  atomic single-use enforcement, same P2002-catch → `already_used` path, same
  Post/Redirect/Get 303 flow to `app/action/returned/done/page.tsx`.
- **The one real difference from Archive: the gate isn't idempotent, it's rank-based.**
  Archive is a boolean flag — re-archiving an already-archived order is a harmless
  no-op treated as `"success"`. "Returned" is a forward-only ladder position, same as
  every other manual `displayStatus` transition, so `lib/returnedAction.ts`'s
  `decideReturnedOutcome()` reuses the same `DISPLAY_STATUS_RANK` comparison the
  dashboard buttons and `PATCH /api/orders/:id/status` already use: valid only when
  `currentRank < DISPLAY_STATUS_RANK.returned` (i.e. from `ordered`/`shipped`/
  `return_requested`). If the order already reached `returned`, `refunded`, or `kept`
  by the time the link is clicked — the user closed the loop from the dashboard, or a
  confirmed-amount refund email auto-advanced it, or (once built) a `kept` decision
  was made — the transition is rejected. Reported as `order_state_changed` (reusing
  Archive's existing outcome, not a new "already_returned" state), on the reasoning
  that "this token's assumption about the order no longer holds" already covers it;
  the same choice is made in `lib/returnedPageState.ts`'s `decideReturnedPageState()`
  for the pre-POST confirm-vs-dead-end page decision.
- On success, the endpoint calls the same `buildStatusTransitionData("returned", ...)`
  every other write path uses (see displayStatus above) — sets `returnedAt` once, on
  first arrival, identically to the dashboard buttons. No `archivedAt` change:
  `"returned"` alone never auto-archives, only `"refunded"`/`"kept"` do.
- 27 new tests across `returnedAction.test.ts`, `returnedPageState.test.ts`, and
  extensions to `cron.test.ts`/`weekly-digest.test.ts` for the new email link —
  covering the status gate (ordered/shipped/return_requested succeed;
  returned/refunded/kept are rejected), invalid (userId mismatch), and the
  action-scoping invariant (a `"returned"` token must not verify as `"archive"`, and
  vice versa). **Not independently unit-tested, matching Archive's own precedent:**
  the actual DB-level single-use enforcement (second POST of the same token →
  `already_used`) — this project's convention is DB-touching code isn't unit-tested,
  only the decision logic it calls is, and Archive's own single-use behavior was
  verified live in production with disposable test orders (see HISTORY.md), not a
  unit test. Mark returned needs the same hands-on verification once deployed.
- **Deliberately not built in this pass:** Mark refunded (next, separately — one
  action at a time) and Mark kept's email one-tap action (dashboard-only for now,
  per its own spec).

### `kept` status — LIVE (`lib/displayStatus.ts`)

Spec'd 2026-07-10, built same day (migration `20260710213509_add_kept_at_to_order`).
"I'm keeping this" — a manual, one-way, terminal `displayStatus`, auto-archiving on
transition, same "chapter closed, stop reminders" semantics as `refunded`, but for
the case where the user decides to keep the item rather than return it.

**Data model**
- `displayStatus` gains a fourth manual value: `"kept"` — no conflict with any existing
  value or reserved word. It was actually half-anticipated already: `TokenRedemption.action`'s
  documentation comment (`prisma/schema.prisma`) already listed `"kept"` as a possible
  action string, and the rotation-risk bullet above (Signed action token invariants)
  already says "Archive/Return/Refund/Kept buttons" — that line still overstates current
  state (only Archive has the email one-tap infra; see the note at the end of that
  section), since only the dashboard button shipped this pass, not the email action.
- `Order.keptAt DateTime?` — parallel to `returnedAt`, set once on first transition to
  `"kept"`, never reset. Needed because "when was the decision made" is meaningful the
  same way it is for `returnedAt`, and nothing else captures it (`archivedAt` isn't a
  reliable proxy — it's reversible via unarchive, `keptAt` isn't).

**Rank — the one non-obvious choice that makes everything else fall out for free**

`DISPLAY_STATUS_RANK` is currently a strictly increasing ladder (`ordered=1` ...
`refunded=5`) that TWO separate gates both key off — `PATCH /api/orders/:id/status`
and `advanceDisplayStatus()` in `app/actions.ts` — via the same rule, `reject if
newRank <= currentRank`. Setting `kept: 4` (tied with `returned`, not a new tier above
`refunded`) satisfies every stated reachability rule through those two *existing*
gates with **zero changes to either gate**:
- from `ordered`(1) / `shipped`(2) / `return_requested`(3) → `kept`(4): `4 > currentRank` → allowed. ✅.
- from `returned`(4) / `refunded`(5) → `kept`(4): `4 <= currentRank` → rejected. ✅ matches "NOT from returned or refunded."
- from `kept`(4) → anywhere: any other manual target has to be a higher rank than 4 to
  pass the same gate, and the only thing ranked higher is `refunded`(5) — see the
  `deriveDisplayStatus` wrinkle below for why that path also needs an explicit block,
  not just reliance on this tie.

**Business logic**
- `ALLOWED_MANUAL_STATUSES` includes `"kept"`; `DISPLAY_STATUS_LABELS["kept"] = "Kept"`.
- **Auto-archive, atomically — `buildStatusTransitionData()`:** on `nextStatus ===
  "kept"`, sets `archivedAt` (if not already set) and `keptAt` (if not already set) in
  the same write, same shape as the `"refunded"` branches. `keptAt`'s parameter is
  optional (`current.keptAt?: Date | null`) so pre-existing callers/tests that never
  knew about it don't need updating. Never backfills `returnedAt` — kept is a distinct
  terminal branch, not a stand-in for having actually returned anything.
- **`deriveDisplayStatus()` never auto-derives `"kept"`** — it doesn't appear in any of
  the ladder's derived branches, so it's only ever reachable manually.
- **The refund-email branch is deliberately exempt from the normal downgrade guard**,
  and would otherwise silently overwrite a manual `"kept"`: it runs *before* the
  rank-based early-return that protects everything else, checking only
  `DISPLAY_STATUS_RANK[target] > currentRank`. With `kept` ranked 4, a `refund` email
  arriving after a user manually marks an order `"kept"` would compute
  `refunded(5) > kept(4)` → true → flip a one-way decision the user just made. Closed
  with an explicit guard at the top of `deriveDisplayStatus()`:
  `if (currentDisplayStatus === "kept") return "kept";`, before the refund branch runs
  at all. This was the single most important correctness wrinkle in the spec pass —
  covered by 4 new tests (`deriveDisplayStatus — kept guard` in `displayStatus.test.ts`).

**Reminder / digest suppression — three separate spots, not one shared list**

Auto-archiving alone (`archivedAt` set) already removes a `kept` order from the
dashboard's active view and from `lib/orderFilters.ts`'s `activeOrderFilter`/
`reminderOrderWhere()` — but matching the codebase's established defense-in-depth
pattern for `refunded`, `displayStatus` is *also* checked directly in three places,
none of which share a constant:
1. `lib/reminders.ts`: `SKIP_DISPLAY_STATUSES = ["returned", "refunded", "kept"]`.
2. `app/api/cron/weekly-digest/route.ts`: `EXCLUDED_STATUSES = ["returned", "refunded", "kept"]`.
3. `lib/refundCheckin.ts`'s `refundCheckinOrderWhere()` requires `displayStatus === "returned"` **exactly** (an allowlist, not a denylist) — `kept` was already excluded here, no change needed.

Three independent lists for what should be one concept is a pre-existing shape, not
something this feature tried to fix in passing — but it means a future "add a new
terminal status" pass has to remember all three, not just `displayStatus.ts`.

**UI (dashboard — `app/page.tsx` card view AND table/list view, `app/orders/[id]/page.tsx`)**
- "I'm keeping this" button, present in all three surfaces: the card view, the
  table/list view's actions column, and the order detail page. Same gate and caption
  everywhere: `DISPLAY_STATUS_RANK[order.displayStatus] < DISPLAY_STATUS_RANK.returned
  && (order.returnDeadline == null || daysUntil(order.returnDeadline, now) >= 0)` —
  covers `ordered`/`shipped`/`return_requested` (deliberately wider than "I'm returning
  this"'s narrower `< DISPLAY_STATUS_RANK.return_requested` gate, since kept must stay
  available at `return_requested` too), and hides once the deadline is confirmed past
  while treating a null deadline as still-open (owner decision, 2026-07-10).
- Inline warning caption beside/beneath the button in all three places —
  `KEPT_WARNING_CAPTION` in `lib/displayStatus.ts` ("This will stop all reminders for
  this order.") — no `window.confirm()`. `requiresConfirmBeforeStatusChange("kept")`
  stays `false`.
- **Correction, 2026-07-10 (same day):** the table/list view was initially left
  unchanged on the reasoning that it never had "I'm returning this"/"Mark as returned"
  either. Added anyway per an explicit owner decision — see `TASKS.md` Decisions log:
  list view is the primary interaction surface for routine order actions, so a button
  belongs there regardless of whether an earlier button happened to set that precedent.
  Styled to match that column's existing buttons (`MarkRefundedButton`/
  `ArchiveOrderButton`/`SoftDeleteOrderButton`), not copied from a nonexistent "I'm
  returning this" instance in that view.
- Badge: `DISPLAY_STATUS_LABELS["kept"] = "Kept"` + `STATUS_STYLES["kept"] = "bg-slate-100
  text-slate-600"` in `app/DisplayStatusBadge.tsx`.

**Email token action — future, still not built**

`/action/kept` will follow the exact Archive pattern (Phases 1-5, `TokenRedemption`/
`ActionLog`/`lib/actionToken.ts`/`lib/actionLinks.ts` all reused unchanged) once the
dashboard feature above ships: `buildActionLink({orderId, userId, action: "kept"})`,
`app/action/kept/page.tsx` (confirm page), `app/api/action/kept/route.ts` (POST
endpoint), `app/action/kept/done/page.tsx`. No new infrastructure — same shape as
`app/action/archive/*` end to end. Listed here as a follow-on only; not scoped for
this pass.

### Active order filter (`lib/orderFilters.ts`)
- `activeOrderFilter = { archivedAt: null, deletedAt: null }` — spread into all queries that should exclude archived/deleted orders: digest, daily reminder cron, refund check-in.
- Dashboard "Archived" tab fetches `{ archivedAt: { not: null }, deletedAt: null }` separately.
- The dashboard main query uses `{ userId, deletedAt: null }` (includes archived so the Archived tab can work), then filters in JS: archived rows are excluded from all views except the explicit "Archived" filter tab.
- Hard-delete: `HARD_DELETE_DAYS = 30`. Nightly cron runs `prisma.order.deleteMany({ where: { deletedAt: { lte: hardDeleteCutoff(now) } } })` as its first step.

### Auto-archive after missed window (`lib/autoArchive.ts`)
- **`AUTO_ARCHIVE_GRACE_DAYS = 14`.** Nightly cron (`/api/cron`, piggybacked on the
  existing daily run, right after the hard-delete step) silently archives orders whose
  `returnDeadline` is 14+ days in the past with no user action taken — no email, no
  `Reminder` row, no `ActionLog` row, just `archivedAt` set via `updateMany`, same
  shape as the manual Archive action but with no per-order write beyond the timestamp.
- **Scoped to `displayStatus: { in: ["ordered", "shipped", "return_requested"] }`** —
  deliberately excludes `"returned"`: that means the user already acted (shipped it
  back), so there's no missed window to sweep, and it's already tracked separately by
  the refund check-in cron (`lib/refundCheckin.ts`). `"refunded"` and `"kept"` are
  never candidates either way — both already auto-archive on their own manual
  transitions, so they never match `activeOrderFilter` (already-archived) by the time
  this sweep would consider them.
- `returnDeadline: null` orders are excluded automatically — Prisma's `lte` never
  matches `null`, so an order with no computed deadline is never touched, no explicit
  guard needed.
- `autoArchiveOrderWhere(now)` spreads `activeOrderFilter` (won't re-touch an
  already-archived/deleted order) — pure, exported, unit-tested without a DB, same
  convention as `reminderOrderWhere()`/`refundCheckinOrderWhere()`.
- No interaction with the reminder loop below: `reminderTypeForOrder` only matches
  exact 7/2/1/0-day thresholds, so reminders for a given order naturally stop firing
  well before this 14-day grace period elapses — ordering the two cron steps doesn't
  matter functionally.
- No audit trail beyond `archivedAt` itself — after the fact, an auto-archived-after-
  missed-window order is indistinguishable from a manually-archived one (same
  pre-existing gap as manual archive, not something this feature introduces).

### Reminders
- **Deadline reminders:** `7_day` / `2_day` / `1_day` / `same_day`. Deduped by `@@unique([orderId, reminderType])`. Skipped when internal `status` is `completed`/`expired`/`return_started`, or when user-facing `displayStatus` is `returned`/`refunded`/`kept` (`lib/reminders.ts` `isEligibleForReminder()`) — deliberately NOT skipped on `return_requested`, since the window is still open and the package may not have shipped. Query excludes archived/deleted orders via `reminderOrderWhere()` (`lib/orderFilters.ts`).
- **Weekly digest:** Sundays 16:00 UTC. Orders due in next 7 days, excludes `returned`/`refunded`/`kept`, excludes `archivedAt`/`deletedAt`. Per-user dedup via lookback query (no `orderId` on this row type).
- **Friday alpha coverage check:** `ALPHA_MODE=true` only. Per-user, lookback 7 days.
- **Refund check-in:** 5 days after `returnedAt` when `returnTrackingNumber` is set; 10 days otherwise. Deduped by `@@unique([orderId, "refund_checkin"])`. Excludes archived/deleted. `refundCheckinOrderWhere()` (`lib/refundCheckin.ts`) requires `displayStatus: "returned"` exactly — once an order transitions to `"refunded"` it no longer matches this query at all, independent of archive state. Auto-archiving a refunded order is a second, redundant layer of exclusion here (via `activeOrderFilter`), not the mechanism that suppresses it — the `displayStatus` mismatch alone already does that.
- All sends go to `order.user.email`. No global `REMINDER_EMAIL` anywhere in active code.

### HTML emails (`lib/emailHtml.ts`) — LIVE across all three link-bearing emails
- Every outbound email that carries a link sends **both** `TextBody` and `HtmlBody`
  (`lib/postmark.ts`'s `sendEmail()` — `htmlBody` is optional and additive, never a
  replacement for the plain-text body). Built 2026-07-10, replacing raw URLs
  pasted into plain text with real `<a>` tags across the deadline reminder
  (`app/api/cron/route.ts`'s `buildHtmlBody()`), the weekly digest
  (`app/api/cron/weekly-digest/route.ts`'s `buildOrderLineHtml()`/`buildBodyHtml()`),
  and the refund check-in (`lib/refundCheckin.ts`'s `buildRefundCheckinHtmlBody()`).
- `lib/emailHtml.ts` is the one shared module: `escapeHtml()` (any dynamic string
  that ultimately traces back to a retailer's email — retailer name, order
  number, line-item name — must be escaped before interpolating into HTML, or a
  stray `&`/`<` breaks the rendered markup; this wasn't a concern in plain text),
  `htmlLink(href, text)` (an anchor with escaped visible text — `href` itself is
  never escaped, because it's always constructed entirely from our own code, a
  `cuid` orderId or a base64url signed token, never retailer-supplied text), and
  `wrapEmailHtml()` (minimal inline-styled document wrapper — email clients don't
  reliably support `<style>` blocks, so every style is inline).
- No new HTML-specific test infra: each HTML body builder is tested the same way
  its plain-text counterpart already was (pure functions, no DB) — asserting the
  link text is exactly the short copy, the `href` isn't visible as text, and the
  embedded action token still verifies with the correct `action`.

### Marketing page routing (`proxy.ts`)
- `MARKETING_HOSTNAMES = ["myreturnwindow.com", "www.myreturnwindow.com"]` — both already alias to this same Vercel deployment.
- Host check runs before the `req.auth` check. A matching host rewrites `/` to `/marketing` and returns immediately — no session lookup, no login redirect.
- Every other hostname (`app.myreturnwindow.com`, `returns-assistant.vercel.app`, previews, localhost) falls through to the existing auth-gated dashboard behavior, unchanged.
- `/api/beta-signup` is public by omission — it's not in the `matcher` array, same pattern as `/api/inbound` and `/api/cron/*`.

### Tracking (`lib/trackingParser.ts`)
- `parseTracking(plainText, rawHtml)` → `{ carrier, trackingNumber, trackingUrl }`.
- Phase 1: scan raw HTML `href` attributes for known carrier domains (most reliable).
- Phase 2: regex fallback on plain text — UPS (`1Z` + 16 alphanumeric), USPS (20-22 digits `9[2-9]…`), FedEx (12 or 15 digits), DHL (10-11 digits). Priority order: UPS → USPS → FedEx → DHL.
- A null result never blocks status advancement.
- `applyShippingTracking`: fires on `shipping_confirmation`, first-write-wins (never overwrites existing).
- `applyReturnTracking`: fires on `return_label`, same first-write-wins semantics.

---

## Inbound routing

`app/api/inbound/route.ts` resolves the receiving user from the inbound token before classification:
1. `MailboxHash` (Postmark populates this from the `+tag` separator) — covers all old `inbound.postmarkapp.com` addresses.
2. Local part of `OriginalRecipient` or `To` when the recipient domain matches `INBOUND_DOMAIN` — covers `<token>@mail.myreturnwindow.com`.

No match → discard (same no-content-log as non-commerce), never attributed to anyone.

---

## Operational rules

- **Name recipients before any send.** Any action that calls `sendEmail()` — `?force=true` cron runs, test sends, one-off scripts — must explicitly confirm who will receive mail before executing. `force=true` creates real `Reminder` rows that block the genuine scheduled send at that threshold.
- **Vercel "Sensitive" flag warning.** Mark Sensitive only for true secrets (API keys, auth tokens, crypto keys). Email addresses, feature flags, and public URLs must stay non-Sensitive so their current values are readable when diagnosing production issues.
- **Auth env var footgun.** `AUTH_SECRET` is the one required auth env var. Every other auth-related env var that has ever been set here (`AUTH_TRUST_HOST`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_URL`) either does nothing in v5 or actively breaks login when set incorrectly.

---

## Cron schedules (`vercel.json`)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron` | `0 14 * * *` | Daily deadline reminders + hard-delete + auto-archive missed windows |
| `/api/cron/weekly-digest` | `0 16 * * 0` | Sunday return-window digest |
| `/api/cron/weekly-coverage` | `0 16 * * 5` | Friday alpha coverage check (ALPHA_MODE only) |

---

## Decisions log
<!-- One entry per non-obvious decision, so future-you knows WHY. See also TASKS.md's own Decisions log for lighter/more frequent entries — this one is for decisions substantial enough to belong in the permanent build record. -->

- **Tiered-window detection and other extraction-quality signals are set by the AI directly via a `needsReview` field in the JSON schema**, not derived from a JS-side string match on notes. Case-sensitive string-match was live-observed to fail on AI capitalization variance (2026-07-08). Fallback `notesIndicateTieredWindow` retained for one release cycle.
- **`Order.needsReview` and `Email.needsReview` serve two different jobs today**: linking-quality review (Order-level, user-facing "Looks correct / Split into separate order" UI) and extraction-quality review (Email-level, admin diagnostic). Extraction-quality signals are deliberately not propagated to `Order.needsReview` until a proper spec pass separates the two concerns.
- **`Email.extractionRaw.needsReview` has inconsistent provenance** across old (JS-derived, pre-2026-07-08) and new (AI-set) rows. Nothing currently reads it; if a future consumer needs to distinguish, look at row `createdAt`.
- **`applyFallbackOrderDate` fires only when the earliest-linked email is `order_confirmation`, `shipping_confirmation`, or `delivery`.** Excluded types (`return_label`, `refund`, `other`) leave `orderDate` null. Rationale: post-purchase-loop emails' `receivedAt` has no defined relationship to the true order date; inventing an anchor from them produces visibly-wrong deadlines (Caroline's Moda, 2026-07-08). `other` is excluded because 14/15 current rows are unlinked marketing; the 1 anomaly is a classification bug tracked separately, not a case for gate special-casing.
- **`kept` (spec'd and built 2026-07-10) is a one-way terminal `displayStatus`, ranked equal to `returned` rather than above `refunded`**, so it auto-archives atomically and stays reachable only from `ordered`/`shipped`/`return_requested` — same "chapter closed, stop reminders" reasoning as `refunded`'s auto-archive. Unlike `refunded`, its rank tie alone doesn't fully protect it: `deriveDisplayStatus()` needed an explicit early return for `currentDisplayStatus === "kept"`, before the refund-email branch, since that branch is deliberately exempt from the normal downgrade guard and would otherwise let a stray refund email silently overwrite a manual kept decision. Ships with an inline warning caption instead of a blocking confirm dialog (owner decision) and hides once the return window is confirmed past, treating a null deadline as still-open.
- **Auto-archive after missed window (built 2026-07-10) is scoped to `ordered`/`shipped`/`return_requested` only, deliberately excluding `returned`.** Rationale: `returned` means the user already acted (shipped the item back) — there's no missed window to sweep, and it's already tracked by the refund check-in cron. 14-day grace period (`AUTO_ARCHIVE_GRACE_DAYS`), fully silent (no email, no `Reminder`/`ActionLog` row) — same "a wrong deadline is worse than a missing one"-adjacent judgment call as elsewhere in this codebase: an unactioned order past its window is either quietly kept or genuinely missed, and in both cases continuing to surface it (or remind about it) serves nobody. Piggybacks on the existing daily `/api/cron` run rather than a new scheduled route.
- **Mark returned (built 2026-07-10) is the second one-tap-from-email action, proving the token infrastructure is actually generic rather than Archive-specific** — `lib/actionToken.ts`/`lib/actionLinks.ts` needed zero changes. Its one departure from Archive's pattern: the gate is rank-based (`DISPLAY_STATUS_RANK`), not idempotent, because "returned" is a forward-only ladder position rather than a boolean flag — an order already at `returned`/`refunded`/`kept` rejects the transition (reported as `order_state_changed`, reusing Archive's existing outcome rather than inventing a new one) instead of silently no-op-succeeding. Built and reviewed one action at a time, deliberately — Mark refunded is next, not bundled into this pass.
- **HTML emails (built 2026-07-10) are additive, never a replacement for plain text** — every `sendEmail()` call that builds an `htmlBody` still sends the existing `textBody` too, for deliverability and for clients that don't render HTML. Applied to all three link-bearing emails (deadline reminder, weekly digest, refund check-in) in the same commit, on the reasoning that the shared infra (`lib/emailHtml.ts`) only needed building once and leaving two of three emails with raw URLs after fixing the third would be a worse, inconsistent state than not starting at all.
- **`computeDeadline()`: a `null`/unknown `returnWindowStartsFrom` anchors directly on `orderDate` (2026-07-15, sidekick-deadline-anchor-mismatch)**, not a delivery-plus-buffer guess. Found via a real production case (Sidekick #SK213978): the web-lookup extraction's own notes said the 60-day window's anchor was genuinely ambiguous, so `returnWindowStartsFrom` persisted `null` — and the old code treated `null` identically to an explicit `delivery_date` anchor, estimating a synthetic delivery date and computing a deadline 7 days later than the true order-date-anchored deadline would be. Rationale for the fix: order-date anchor is always <= delivery-date anchor, so defaulting an unconfirmed anchor to orderDate can never compute a deadline later than the true one could be — same "a wrong deadline is worse than a missing one" principle as the tiered-window entry above. `deadlineIsEstimated` stays `true` in this branch even though `orderDate` is a real value, because the anchor choice itself is an assumption. Diagnostic-first process caught that the reported symptom's premise ("the policy states 60 days from purchase") didn't match the actual extraction notes (genuinely ambiguous) before any fix was written — see TASKS.md's Decisions log for the full before/after.
- **`STANDARD_SHIPPING_DAYS` tightened 7 -> 5 days (2026-07-15, same session)** — the synthetic buffer used only when a policy is explicitly `delivery_date`-anchored but no real delivery signal exists yet. Same "wrong deadline worse than missing" principle: owner explicitly accepted that a user might occasionally start a return a couple of days before they strictly needed to, in exchange for never computing a deadline later than the real one. Backfilled 20 active orders whose stored `returnDeadline` predated one or both changes (19 delivery-date-anchored orders tightened by 2 days each from the buffer change; Sidekick tightened by 7 days from the anchor change) — every affected order's deadline moved earlier or stayed the same, never later, verified before writing.
- **`needsReview` on a kept order keys off the incoming email's type, not a blanket "kept is terminal" guard (2026-07-18, #6a follow-up)**: a `return_label`/`refund` reaching a `"kept"` order is a genuine contradiction of a settled decision and must keep surfacing for review, even on an exact order-number match; `order_confirmation`/`shipping_confirmation`/`delivery` reaching a `"kept"` order is not (no conflicting signal, would just be noise). A prior diagnostic (Shopbop #142770152) had found the exact-match query itself was never the problem — a no-order-number refund email was correctly fallback-matching and correctly forcing review; the real, narrower gap was that the *same* conflict wasn't being caught when the match happened to be an exact hit instead of a fuzzy one. Fixed additively via `computeKeptStatusConflict()`, leaving the existing prefix/fallback-match review-forcing (Mango `F4VLSF`/`F4VLSF00`, still `needsReview`) untouched.

---

## How to deploy

- Dev: `npm run dev`
- Build (also type-checks): `npm run build`
- Tests: `npx vitest run`
- Migrate: `npx prisma migrate dev --name <description>`
- Deploy: **manual** — `npx vercel --prod` from repo root. No GitHub auto-deploy.
- Env vars: `npx vercel env add <NAME> <environment>` — new/changed vars take effect on the next deploy, not immediately.
- Verify: `npx vercel inspect returns-assistant.vercel.app | grep "Git Commit"` to confirm the live deploy matches the expected commit.

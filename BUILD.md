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

**One-tap-from-email is live for Archive** (Section A of the one-tap-from-email spec,
2026-07-04) — this is no longer just a design document, it's real infrastructure with
one real action built on it. `lib/actionToken.ts` (signed, single-use, 14-day tokens),
`TokenRedemption`/`ActionLog` (audit + single-use enforcement), `POST
/api/action/archive` (redemption endpoint), `app/action/archive/page.tsx` +
`app/action/archive/done/page.tsx` (confirmation + failure-mode pages), and the
Archive link embedded directly in reminder and Sunday digest emails (`lib/
actionLinks.ts`'s `buildActionLink()`, called from both `app/api/cron/route.ts` and
`app/api/cron/weekly-digest/route.ts`) are all deployed and owner-verified in
production. The infrastructure is deliberately generic — every other spec'd action
(Mark returned, Mark refunded, Mark kept, Unarchive) is the same shape (one
redemption endpoint + one confirmation page) and needs no new token/audit
infrastructure, but none of them are built yet. See TASKS.md 🟡 Next.

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

### TokenRedemption (one-tap-from-email — live for Archive)

```prisma
model TokenRedemption {
  id         String   @id @default(cuid())
  tokenHash  String   @unique // hash of the token, not the raw token — DB unique constraint enforces single-use atomically
  action     String
  orderId    String?  // nullable + SetNull on delete, same pattern as Reminder — a hard-deleted Order shouldn't block or erase this audit trail
  redeemedAt DateTime @default(now())
}
```

### ActionLog (one-tap-from-email — live for Archive)

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

---

## Signed action token invariants (one-tap-from-email — live for Archive)

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
  (Note, 2026-07-10: this bullet has always overstated current state — only Archive
  is actually live as a one-tap email action today. "Return"/"Refund"/"Kept" here were
  written aspirationally; Kept is now spec'd — see `kept` status below — but not built.
  Not fixed here since correcting it would touch a line unrelated to this spec pass.)
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

```
if deliveryDate known:
  anchor = (returnWindowStartsFrom === "order_date" && orderDate) ? orderDate : deliveryDate
  returnDeadline = anchor + returnWindowDays
  deadlineIsEstimated = false

else if orderDate known:
  if returnWindowStartsFrom === "order_date":
    returnDeadline = orderDate + returnWindowDays   ← NO shipping buffer
    deadlineIsEstimated = false
  else:
    returnDeadline = orderDate + STANDARD_SHIPPING_DAYS(7) + returnWindowDays
    deadlineIsEstimated = true

else:
  returnDeadline = null
```

The no-buffer rule for order-date-anchored policies is intentional and was a real bug fix. Do not add the shipping buffer back.

### Order linking (`lib/linkOrder.ts`)
- Match on `retailer` + `orderNumber`, case-insensitively, always scoped by `userId`.
- **Fuzzy prefix match:** when exact match fails, check existing orders for a prefix relationship in either direction (min `MIN_PREFIX_MATCH_LENGTH = 5` chars). A prefix match always forces `needsReview: true`, overriding `recomputeOrderStatus`'s normal logic. Prefix matches need human confirmation.
- **Merge rule:** new non-null value wins; null never erases existing data. Exception: `order_confirmation` `orderTotal` is authoritative once present.
- **Fallback `orderDate`, gated by earliest-linked email's `emailType`:** if an Order has no `orderDate` after linking, `applyFallbackOrderDate` derives one from the earliest linked email — but only when that email's type is `order_confirmation`, `shipping_confirmation`, or `delivery` (not scoped to `order_confirmation` alone — Amazon's transactional mail never produces that emailType at all, only `shipping_confirmation`; Bug 8). `return_label`, `refund`, and `other`-typed earliest emails leave `orderDate` null and `orderDateEstimated` false — their `receivedAt` has no defined relationship to the true order date (post-purchase-loop mail, or for `other`, unrelated marketing), and inventing an anchor from them produced a visibly-wrong deadline in production (Caroline's Moda order, 2026-07-08; see Decisions log). **Any new `emailType` value added to the enum must be explicitly classified into the allowed or excluded bucket at the point of addition — there's no default.** For allowed types, two tiers: (1) parse the `Date:` line from a forwarded-message header in the email's body, handling both Gmail and Apple Mail forwarded-header formats, when present; (2) otherwise fall back to the email's own `receivedAt` (Postmark's parsed `Date` header, `app/api/inbound/route.ts`) — always present, and a good proxy for auto-forwarded/directly-relayed transactional mail. Either tier sets `orderDateEstimated: true` on the Order (distinct from `deadlineIsEstimated`, which stays coupled: an inferred order date always makes any deadline computed from it estimated too). `mergeEmailIntoOrder` clears `orderDateEstimated` back to `false` if a later email supplies a genuinely-extracted `orderDate` that supersedes the fallback value.
- **Refund-email fallback matching (Bugs 9+10):** a `refund`-type email with no `orderNumber` (Shopbop and H&M both did this — retailers often omit it from refund notifications) still gets a shot at linking, via `findRefundFallbackOrder()` — scoped strictly to `emailType === "refund"`, every other email type still requires an `orderNumber` or gets `needsReview: true` and stops. Tiered, most specific first: (1) line-item name overlap against candidate orders for the same retailer, (2) `orderTotal` soft match (a loose `<=` comparison, not exact equality — refunds are frequently partial), (3) recency (the retailer's only order, or its most recently created one). Every fallback match sets `needsReview: true` + a `userNote` audit line, same convention as the retailer-prefix match. If there's no candidate order for that retailer at all, a new Order is created from the refund email alone (`createOrderFromEmail`, unmodified) rather than left permanently orphaned — expect these to be sparse (no `orderDate`, no prior line-item pricing history), which is expected, not a bug.
- `recomputeDisplayStatus()` and `applyShippingTracking()` / `applyReturnTracking()` are called after every `linkEmailToOrder`.

### displayStatus (`lib/displayStatus.ts`)
- Values and ranks: `ordered=1`, `shipped=2`, `return_requested=3`, `returned=4`, `refunded=5`.
- **Never-downgrade rule:** `deriveDisplayStatus()` only advances rank, never decreases it. A manually-set `return_requested` survives a new shipping email arriving later.
- Auto-advance rules (in `deriveDisplayStatus`): `return_label` → `return_requested`; `shipping_confirmation` or `delivery` → `shipped`; else → `ordered`. No auto-advance past `return_requested` — **except** a `refund`-type email (see below), the one auto-derivation signal allowed to move an order past `return_requested`/`returned` on its own.
- **Refund emails branch by confirmed amount (Bugs 9+10+11, supersedes the original "refunded is never auto-derived" rule):** retailer refund emails are frequently vague ("we're processing your refund") without confirming the money actually moved back — catching exactly that ambiguity is the product's job, so a `refund` email doesn't uniformly mean the same thing. `deriveDisplayStatus(emailTypes, currentDisplayStatus, hasConfirmedRefundAmount)` — a confirmed amount (`Email.refundAmount` non-null with `refundAmountConfidence !== "low"`, see Extraction above) advances straight to `"refunded"`; no confirmed amount advances only to `"returned"`. This check runs *before* the return_requested-or-higher early-return that gates the rest of the ladder — the final rank comparison (not the early-return) is what still protects against downgrade in both branches.
  - Confirmed amount → `"refunded"`: chapter closed, auto-archives, no further reminders.
  - No confirmed amount → `"returned"`: **not** archived, so the existing refund check-in reminder (cron-driven off `displayStatus === "returned"`, see Reminders below) naturally nudges the user later to verify the money actually landed. No separate "scheduling" step needed — the cron's own query already covers it once the order lands here.
- `PATCH /api/orders/:id/status` accepts `return_requested`/`returned`/`refunded`. Rejects backwards movement (400). Sets `returnedAt` on the first transition to `"returned"`.
- `advanceDisplayStatus()` in `app/actions.ts` also sets `returnedAt` when advancing to `"returned"` for the first time.
- Both of the above, and `recomputeDisplayStatus()` in `lib/linkOrder.ts` (the auto-derivation path), build their `prisma.order.update()` data via the shared `buildStatusTransitionData()` (`lib/displayStatus.ts`), so all three implementations of the same transition contract can't drift apart.
- **Refunded auto-archives, atomically:** transitioning to `"refunded"` sets `archivedAt = now()` in the *same* `update()` call as `displayStatus` — refunded is "chapter closed," same as a manual archive. If the order is already archived, `archivedAt` is left untouched (not overwritten). Unarchiving a refunded order does not reverse `displayStatus` — refunded stays one-way; archive is just visibility.
- **`returnedAt` backfills on the direct-to-refunded jump too:** the two manual endpoints always gate `"refunded"` behind an existing `"returned"` status, so `returnedAt` is already set by the time they call `buildStatusTransitionData()`. But an auto-derived confirmed-amount refund can reach `"refunded"` directly from an earlier status without ever passing through `"returned"` — `buildStatusTransitionData()` backfills `returnedAt` on arrival at `"refunded"` too, not just `"returned"`, so it's never left null for these orders.
- **Confirm gate:** the dashboard/detail-page "Mark as refunded" button (`app/MarkRefundedButton.tsx`) shows a native `window.confirm()` with teaching copy before submitting — refunded is irreversible in the UI and has the archiving side effect, both surprising enough to warrant explanation, not just "are you sure?". `requiresConfirmBeforeStatusChange()` gates only `"refunded"` — `"return_requested"` and `"returned"` stay frictionless.

### `kept` status — SPEC ONLY, not built (target: `lib/displayStatus.ts`)

Read-only spec pass, 2026-07-10. Nothing below is implemented — see `TASKS.md` 🟡 Next
for the pointer. Written here rather than a standalone doc because it's entirely an
extension of the existing `displayStatus` machinery documented just above, not a new
subsystem.

**Data model**
- `displayStatus` gains a fourth manual value: `"kept"` — no conflict with any existing
  value or reserved word. It's actually half-anticipated already: `TokenRedemption.action`'s
  documentation comment (`prisma/schema.prisma`) already lists `"kept"` as a possible
  action string, and the rotation-risk bullet above (Signed action token invariants)
  already says "Archive/Return/Refund/Kept buttons" — inaccurately, since only Archive
  is live today (see the note at the end of that section).
- New field: `Order.keptAt DateTime?` — parallel to `returnedAt`, set once on first
  transition to `"kept"`, never reset. Needed because "when was the decision made" is
  meaningful the same way it is for `returnedAt`, and nothing else captures it (an
  auto-archive's `archivedAt` isn't a reliable proxy — see below, kept sets both
  atomically, so they'd usually match, but `archivedAt` is reversible via unarchive
  while `keptAt` must not be treated as reversible evidence of the decision).
- **Migration: yes**, but small — `displayStatus` is an unconstrained `String` column
  (no DB-level enum), so the new *value* needs no schema change, only the new
  `keptAt DateTime?` column does. One additive, nullable, no-backfill migration
  (`npx prisma migrate dev --name add_kept_at_to_order`), same shape as
  `20260707233740_add_estimated_delivery_and_delivered_at`.

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
- `ALLOWED_MANUAL_STATUSES` gains `"kept"`; `DISPLAY_STATUS_LABELS["kept"] = "Kept"`.
- **Auto-archive, atomically — extend `buildStatusTransitionData()`:** add
  `if (nextStatus === "kept" && !current.archivedAt) data.archivedAt = new Date()` and
  `if (nextStatus === "kept" && !current.keptAt) data.keptAt = new Date()`, same shape
  as the existing `"refunded"` branches. Since this one function is what all three
  write paths (`PATCH` route, `app/actions.ts`, and `recomputeDisplayStatus()`'s
  auto-derivation path) already share, this is the single place to change for the
  atomic-write contract — but see below, `recomputeDisplayStatus()` must never actually
  be allowed to pass `"kept"` in.
- **`deriveDisplayStatus()` must NEVER auto-derive `"kept"`** — trivially true as
  written today (`"kept"` doesn't appear in any of the ladder's derived branches), so
  there's nothing to *add*. The real risk is the other direction:
- ⚠️ **The refund-email branch is deliberately exempt from the normal downgrade
  guard, and as written today it would silently overwrite a manual `"kept"`.**
  `deriveDisplayStatus()`'s refund branch is explicitly "the one auto-derivation
  signal allowed to move an order past `return_requested`/`returned` on its own" — it
  runs *before* the rank-based early-return that protects everything else, and only
  checks `DISPLAY_STATUS_RANK[target] > currentRank`. With `kept` ranked 4, a `refund`
  email arriving after a user manually marks an order `"kept"` would compute
  `refunded(5) > kept(4)` → **true** → silently flip a one-way "terminal" decision the
  user just made. This must be closed with an explicit early guard —
  `if (currentDisplayStatus === "kept") return "kept";` — at the top of
  `deriveDisplayStatus()`, before the refund branch, not merely relying on the rank tie.
  This is the single most important correctness wrinkle in this spec.

**Reminder / digest suppression — three separate spots, not one shared list**

Auto-archiving alone (`archivedAt` set) already removes a `kept` order from the
dashboard's active view and from `lib/orderFilters.ts`'s `activeOrderFilter`/
`reminderOrderWhere()` — but the codebase's own established pattern for `refunded`
is defense-in-depth: `displayStatus` is *also* checked directly, independent of
archive state, in three places, none of which share a constant:
1. `lib/reminders.ts`: `SKIP_DISPLAY_STATUSES = ["returned", "refunded"]` → needs `"kept"` added.
2. `app/api/cron/weekly-digest/route.ts`: `EXCLUDED_STATUSES = ["returned", "refunded"]` → needs `"kept"` added.
3. `lib/refundCheckin.ts`'s `refundCheckinOrderWhere()` requires `displayStatus === "returned"` **exactly** (an allowlist, not a denylist) — `kept` is naturally excluded here already, no change needed.

Three independent lists for what should be one concept is a pre-existing shape, not
something this feature should try to fix in passing — but it does mean a future
"add a new terminal status" pass has to remember all three, not just `displayStatus.ts`.

**UI (dashboard — `app/page.tsx`, `app/orders/[id]/page.tsx`)**
- New "I'm keeping this" button. **Gate on `DISPLAY_STATUS_RANK[order.displayStatus] <
  DISPLAY_STATUS_RANK.returned`** (i.e. rank < 4, covering `ordered`/`shipped`/
  `return_requested`) — **not** the narrower `< DISPLAY_STATUS_RANK.return_requested`
  gate the existing "I'm returning this" button uses. That narrower gate stops
  rendering once an order reaches `return_requested` (where "Mark as returned" takes
  over instead) — reusing it verbatim would silently violate the stated requirement
  that kept be available from `return_requested` too. This wasn't stated as a
  distinction in the request; flagging it here as the resolution.
- **DECIDED (2026-07-10): "I'm keeping this" hides once the return window has passed.**
  A new condition — no existing manual-status button gates on `returnDeadline` today
  (`return_requested`/`returned`/`refunded` are pure rank checks). Combined gate:
  `rank < DISPLAY_STATUS_RANK.returned && (order.returnDeadline == null ||
  daysUntil(order.returnDeadline, now) >= 0)` — reusing the existing `daysUntil()`
  helper (`lib/reminders.ts`, already imported this way on the Archive confirm page).
  **Edge case not explicitly addressed by the decision, flagging rather than assuming:**
  an order with `returnDeadline: null` (no deadline ever computed) has no "window" to
  have passed — the rule above lets the button show for these. If the intent was
  narrower ("only show when a deadline exists AND hasn't passed"), that's a one-line
  change (`order.returnDeadline != null && daysUntil(...) >= 0`) — confirm before build.
- **DECIDED (2026-07-10): inline warning caption, no confirm dialog.** Small copy
  beneath or beside the button — e.g. "This will stop all reminders for this order" —
  visible before the tap, no modal and no separate confirmation step. This resolves
  the tension noted in the prior draft (kept shares refunded's two confirm-triggering
  properties — one-way, auto-archives — but the owner's call is that always-visible
  copy satisfies "consequence is clear before they tap" without the friction cost of a
  blocking dialog on a no-dollar-amount-at-stake action). Note for whenever this gets
  built: `requiresConfirmBeforeStatusChange()` should stay returning `false` for
  `"kept"` (unchanged) — this is a rendering-layer caption, not a change to that
  function's contract, so no new branch there.
- New badge: `DISPLAY_STATUS_LABELS["kept"] = "Kept"` in `app/DisplayStatusBadge.tsx`,
  plus a `STATUS_STYLES["kept"]` entry — needs a color distinct from the existing four
  (stone/blue/amber/green/purple all taken).

**Email token action — future, not this session**

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

### Reminders
- **Deadline reminders:** `7_day` / `2_day` / `1_day` / `same_day`. Deduped by `@@unique([orderId, reminderType])`. Skipped when internal `status` is `completed`/`expired`/`return_started`, or when user-facing `displayStatus` is `returned`/`refunded` (`lib/reminders.ts` `isEligibleForReminder()`) — deliberately NOT skipped on `return_requested`, since the window is still open and the package may not have shipped. Query excludes archived/deleted orders via `reminderOrderWhere()` (`lib/orderFilters.ts`).
- **Weekly digest:** Sundays 16:00 UTC. Orders due in next 7 days, excludes `returned`/`refunded`, excludes `archivedAt`/`deletedAt`. Per-user dedup via lookback query (no `orderId` on this row type).
- **Friday alpha coverage check:** `ALPHA_MODE=true` only. Per-user, lookback 7 days.
- **Refund check-in:** 5 days after `returnedAt` when `returnTrackingNumber` is set; 10 days otherwise. Deduped by `@@unique([orderId, "refund_checkin"])`. Excludes archived/deleted. `refundCheckinOrderWhere()` (`lib/refundCheckin.ts`) requires `displayStatus: "returned"` exactly — once an order transitions to `"refunded"` it no longer matches this query at all, independent of archive state. Auto-archiving a refunded order is a second, redundant layer of exclusion here (via `activeOrderFilter`), not the mechanism that suppresses it — the `displayStatus` mismatch alone already does that.
- All sends go to `order.user.email`. No global `REMINDER_EMAIL` anywhere in active code.

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
| `/api/cron` | `0 14 * * *` | Daily deadline reminders + hard-delete |
| `/api/cron/weekly-digest` | `0 16 * * 0` | Sunday return-window digest |
| `/api/cron/weekly-coverage` | `0 16 * * 5` | Friday alpha coverage check (ALPHA_MODE only) |

---

## Decisions log
<!-- One entry per non-obvious decision, so future-you knows WHY. See also TASKS.md's own Decisions log for lighter/more frequent entries — this one is for decisions substantial enough to belong in the permanent build record. -->

- **Tiered-window detection and other extraction-quality signals are set by the AI directly via a `needsReview` field in the JSON schema**, not derived from a JS-side string match on notes. Case-sensitive string-match was live-observed to fail on AI capitalization variance (2026-07-08). Fallback `notesIndicateTieredWindow` retained for one release cycle.
- **`Order.needsReview` and `Email.needsReview` serve two different jobs today**: linking-quality review (Order-level, user-facing "Looks correct / Split into separate order" UI) and extraction-quality review (Email-level, admin diagnostic). Extraction-quality signals are deliberately not propagated to `Order.needsReview` until a proper spec pass separates the two concerns.
- **`Email.extractionRaw.needsReview` has inconsistent provenance** across old (JS-derived, pre-2026-07-08) and new (AI-set) rows. Nothing currently reads it; if a future consumer needs to distinguish, look at row `createdAt`.
- **`applyFallbackOrderDate` fires only when the earliest-linked email is `order_confirmation`, `shipping_confirmation`, or `delivery`.** Excluded types (`return_label`, `refund`, `other`) leave `orderDate` null. Rationale: post-purchase-loop emails' `receivedAt` has no defined relationship to the true order date; inventing an anchor from them produces visibly-wrong deadlines (Caroline's Moda, 2026-07-08). `other` is excluded because 14/15 current rows are unlinked marketing; the 1 anomaly is a classification bug tracked separately, not a case for gate special-casing.
- **`kept` (spec'd 2026-07-10, not built) is a one-way terminal `displayStatus`, ranked equal to `returned` rather than above `refunded`**, so it auto-archives atomically and stays reachable only from `ordered`/`shipped`/`return_requested` — same "chapter closed, stop reminders" reasoning as `refunded`'s auto-archive. Unlike `refunded`, its rank tie alone doesn't fully protect it: `deriveDisplayStatus()`'s refund-email branch is deliberately exempt from the normal downgrade guard, so it must gain an explicit early return for `currentDisplayStatus === "kept"` or a stray refund email could silently overwrite a manual kept decision.

---

## How to deploy

- Dev: `npm run dev`
- Build (also type-checks): `npm run build`
- Tests: `npx vitest run`
- Migrate: `npx prisma migrate dev --name <description>`
- Deploy: **manual** — `npx vercel --prod` from repo root. No GitHub auto-deploy.
- Env vars: `npx vercel env add <NAME> <environment>` — new/changed vars take effect on the next deploy, not immediately.
- Verify: `npx vercel inspect returns-assistant.vercel.app | grep "Git Commit"` to confirm the live deploy matches the expected commit.

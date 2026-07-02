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

### DiscardLog

```prisma
model DiscardLog {
  id         String   @id @default(cuid())
  reason     String
  occurredAt DateTime @default(now())
  // Contains only reason + timestamp. No email content, no userId. Ever.
}
```

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

### Extraction (`lib/extract.ts`)
- **Model:** `claude-sonnet-4-6`.
- **`retailer` from body only** — never from `From` header or subject line.
- **`orderNumber`** may be read from the subject line as well as the body.
- **Return `null` for any field not clearly present.** Null + low confidence is always better than a wrong answer. A wrong deadline is worse than a missing one.
- When `returnWindowDays` is null and `retailer` is known: run the web-search policy lookup (`buildPolicyLookupPrompt`). Set `policySource: "web_lookup"` on success; leave null + `needsReview: true` on ambiguous result.
- `order_confirmation` totals are authoritative once present (`resolveOrderTotal()`) — no other email type can override them.

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
- **Fallback `orderDate`:** if an Order has no `orderDate` after linking, parse the `Date:` line from the forwarded-message header in the earliest `order_confirmation` email's body. Handles both Gmail and Apple Mail forwarded-header formats. Scoped to `order_confirmation` only. Result is always `deadlineIsEstimated: true`.
- `recomputeDisplayStatus()` and `applyShippingTracking()` / `applyReturnTracking()` are called after every `linkEmailToOrder`.

### displayStatus (`lib/displayStatus.ts`)
- Values and ranks: `ordered=1`, `shipped=2`, `return_requested=3`, `returned=4`, `refunded=5`.
- **Never-downgrade rule:** `deriveDisplayStatus()` only advances rank, never decreases it. A manually-set `return_requested` survives a new shipping email arriving later.
- Auto-advance rules (in `deriveDisplayStatus`): `return_label` → `return_requested`; `shipping_confirmation` or `delivery` → `shipped`; else → `ordered`. No auto-advance past `return_requested`.
- `PATCH /api/orders/:id/status` accepts `return_requested`/`returned`/`refunded`. Rejects backwards movement (400). Sets `returnedAt` on the first transition to `"returned"`.
- `advanceDisplayStatus()` in `app/actions.ts` also sets `returnedAt` when advancing to `"returned"` for the first time.

### Active order filter (`lib/orderFilters.ts`)
- `activeOrderFilter = { archivedAt: null, deletedAt: null }` — spread into all queries that should exclude archived/deleted orders: digest, daily reminder cron, refund check-in.
- Dashboard "Archived" tab fetches `{ archivedAt: { not: null }, deletedAt: null }` separately.
- The dashboard main query uses `{ userId, deletedAt: null }` (includes archived so the Archived tab can work), then filters in JS: archived rows are excluded from all views except the explicit "Archived" filter tab.
- Hard-delete: `HARD_DELETE_DAYS = 30`. Nightly cron runs `prisma.order.deleteMany({ where: { deletedAt: { lte: hardDeleteCutoff(now) } } })` as its first step.

### Reminders
- **Deadline reminders:** `7_day` / `2_day` / `1_day` / `same_day`. Deduped by `@@unique([orderId, reminderType])`.
- **Weekly digest:** Sundays 16:00 UTC. Orders due in next 7 days, excludes `returned`/`refunded`, excludes `archivedAt`/`deletedAt`. Per-user dedup via lookback query (no `orderId` on this row type).
- **Friday alpha coverage check:** `ALPHA_MODE=true` only. Per-user, lookback 7 days.
- **Refund check-in:** 5 days after `returnedAt` when `returnTrackingNumber` is set; 10 days otherwise. Deduped by `@@unique([orderId, "refund_checkin"])`. Excludes archived/deleted.
- All sends go to `order.user.email`. No global `REMINDER_EMAIL` anywhere in active code.

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

## How to deploy

- Dev: `npm run dev`
- Build (also type-checks): `npm run build`
- Tests: `npx vitest run`
- Migrate: `npx prisma migrate dev --name <description>`
- Deploy: **manual** — `npx vercel --prod` from repo root. No GitHub auto-deploy.
- Env vars: `npx vercel env add <NAME> <environment>` — new/changed vars take effect on the next deploy, not immediately.
- Verify: `npx vercel inspect returns-assistant.vercel.app | grep "Git Commit"` to confirm the live deploy matches the expected commit.

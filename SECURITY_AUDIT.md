# Return Window — Security Audit

**Scope:** Endpoint-by-endpoint review of the `returns_assistant-main` codebase against nine vulnerability classes: authentication, authorization, rate limiting, webhook verification, IDOR, XSS, prompt injection, CSRF, SSRF.
**Method:** Static read of every route handler, server action, middleware, the admin surface, the crypto/extraction pipeline, and all render paths, plus a dependency advisory scan.
**Deliverable:** Findings only, prioritized. No fixes applied. Remediation *directions* are given, not patches.

**Overall disposition:** The core app is in notably good shape on the things that usually go wrong — authorization/IDOR is correct on every user-scoped route, the one-click email-action tokens are properly signed and single-use, secrets and crypto are handled well, and there is no raw-HTML rendering of email content. The concentrated risk is at the **one public, unauthenticated ingestion point (`/api/inbound`)** and the **complete absence of rate limiting**. Those two, together, are where attention should go first.

---

## Coverage matrix

Every entry point was walked. `✓` = checked and no issue in that class. `—` = class not applicable to that surface. `⚠︎ Fn` = finding, see below.

| Entry point | AuthN | AuthZ / IDOR | Rate limit | Webhook verif. | XSS | Prompt inj. | CSRF | SSRF |
|---|---|---|---|---|---|---|---|---|
| `POST /api/inbound` | ⚠︎ C1 | ✓ (token→user) | ✓ (H1, 30/hr per token) | ⚠︎ C1 | ✓ | ⚠︎ M2 / L4 | — | ✓ |
| `GET /api/cron` | ✓ secret | ✓ | ✓ (secret) | ✓ | ✓ (esc.) | — | — | ✓ |
| `GET /api/cron/weekly-coverage` | ✓ secret | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `GET /api/cron/weekly-digest` | ✓ secret | ✓ | ✓ | ✓ | ✓ (esc.) | — | — | ✓ |
| `POST /api/action/archive` | ✓ token | ✓ token-scoped | ✓ single-use | n/a | ✓ | — | ✓ nonce | — |
| `POST /api/action/returned` | ✓ token | ✓ token-scoped | ✓ single-use | n/a | ✓ | — | ✓ nonce | — |
| `PATCH /api/orders/[id]/archive` | ✓ | ✓ owner-check | ✗ | — | ✓ | — | ⚠︎ L3 | — |
| `PATCH /api/orders/[id]/delete` | ✓ | ✓ owner-check | ✗ | — | ✓ | — | ⚠︎ L3 | — |
| `PATCH /api/orders/[id]/status` | ✓ | ✓ owner + allowlist | ✗ | — | ✓ | — | ⚠︎ L3 | — |
| `GET /api/gmail-code` | ✓ | ✓ session-scoped | ✗ | — | ✓ | — | — | — |
| `POST /api/beta-signup` | — public | — | ✓ (H1, 3/hr per IP) | — | ✓ | — | ✓ | — |
| `GET/POST /api/auth/[...nextauth]` | ✓ magic-link + allowlist | ✓ | ✓ (H1, 8/hr email + 20/hr IP) | — | ✓ | — | ✓ | — |
| Server actions (orders/emails/settings) | ✓ | ✓ owner-check | ✗ | — | ✓ | — | ✓ (framework) | — |
| Admin `/admin` | ✓ ADMIN_SECRET | ✓ | ✗ | — | ✓ | — | ✓ | — |
| Admin `/admin/users/*`, `/onboarding` | ✓ identity | ✓ | ✗ | — | ✓ | — | ✓ | — |
| `(app)/*` pages (dashboard, detail, settings, alerts) | ✓ layout+page | ✓ session-scoped | — | — | ✓ | — | — | — |
| Middleware `proxy.ts` | ⚠︎ L2 (matcher drift) | — | — | — | — | — | — | — |

---

## CRITICAL

### C1 — Inbound webhook has no sender verification, and attributes mail by a non-secret token
**Class:** Webhook verification / Authentication / Rate limiting
**Location:** `app/api/inbound/route.ts`; token model in `prisma/schema.prisma` (`inboundToken String @unique @default(cuid())`); `lib/inboundAddress.ts`

**What it is.** The inbound handler accepts `request.json()` and processes it with **no verification that the request actually came from Postmark** — no HTTP Basic Auth on the webhook URL, no signature check, no shared secret, no source restriction. The only thing tying an inbound email to a user account is the `inboundToken` carried *inside the attacker-controllable payload* (`MailboxHash` / `OriginalRecipient` / `To`). That token is a **CUID**, which is designed for collision-resistant uniqueness, **not** unguessability — it embeds a timestamp and counter and is not secret-strength. Worse, the token is not treated as a secret anywhere: it *is* the user's forwarding email address (`<token>@mail.myreturnwindow.com`), shown in Settings, echoed into admin notification emails, and typed by the user into Gmail.

**Attacker scenario.** Anyone who learns or guesses a user's forwarding address can `POST` forged Postmark-shaped payloads directly to `/api/inbound` and have them ingested as that user's real mail. Concretely they can: inject fabricated orders and **fake refund/return confirmations** into the victim's dashboard (which can auto-advance order status — see L4); plant a malicious "return portal" link that the app then presents as trusted (see M2); and, because each accepted email fans out to a Haiku classify call, a Sonnet extraction call, and up to **three** web-search calls, drive **unbounded Anthropic API spend** attributed to the account. There is no rate limiting to slow enumeration or cap cost (see H1).

**Evidence.** The handler's only gate is `extractInboundToken(payload)` → `prisma.user.findUnique({ where: { inboundToken } })`; if a user resolves, it proceeds to `isCommerceEmail(...)`, `prisma.email.create(...)`, and `runExtraction(...)`. There is no `Authorization`/signature check anywhere in the file.

**Remediation direction.** Authenticate the webhook itself rather than trusting the payload: configure the Postmark inbound webhook URL with an HTTP Basic Auth credential (or a long random path/secret segment) and reject any request that doesn't present it, before parsing. Treat the routing token and the webhook secret as two separate things — the token says *who*, the secret proves *from Postmark*. Consider rotating `inboundToken` to a high-entropy random value going forward (keeping the CUID fallback for existing forwards), and add per-source/per-token rate limiting (H1).

---

## HIGH

### H1 — No rate limiting or abuse controls on any public endpoint — ✅ RESOLVED 2026-07-16
**Class:** Rate limiting
**Location:** whole app — no limiter middleware or dependency exists. Acute at `app/api/inbound/route.ts`, `app/api/beta-signup/route.ts`, and the magic-link send path (`app/login/actions.ts` → `auth.ts`).

**Resolution.** Postgres-backed rate limiting (`lib/rateLimit.ts`, new `RateLimitCounter` table, fixed-window approximation) rolled out to all three surfaces in a staged, one-endpoint-at-a-time sequence, each phase owner-reviewed before the next:
- **`/api/inbound`** — 30 messages/hour per `inboundToken`. Blocked requests get a 429 + `Retry-After`, never create an `Email` row or touch the (separate-concern) inbound volume counter. Admin notified on a block, deduped 1/hr per token.
- **`/api/beta-signup`** — 3 signups/hour per IP. Blocked requests get a 429, no `BetaSignup` row created, no admin notification for the block itself (low-value endpoint). Separately, the pre-existing `beta_signup` admin notification (previously unconditional on every call) is now deduped per-email/24h.
- **Magic-link send** (`auth.ts` → `lib/magicLinkRateLimit.ts`) — two limits, both must pass: 8 sends/hour per email, 20 sends/hour per IP. Deliberately **loud, not silent**: the user sees "You've requested several sign-in links recently. Please wait a few minutes and try again." — unlike the allowlist gate beside it, which stays silent by design. Admin notified on a block (deduped per-email/24h) only when the affected email is allowlisted, so probing an unknown address doesn't double up with the existing `allowlist_rejection` signal. See TASKS.md's Decisions log for the full rationale on both of those choices.

All three limits verified via unit tests exercising the real rate-limit arithmetic (not mocked) through each entry point; owner verified each phase live in production before the next phase started.

**What it is.** There is no rate limiting anywhere in the request path (`proxy.ts` does none; there's no rate-limit library in `package.json`). Three public surfaces are abusable:

- **`/api/inbound`** — the cost-amplification vector described in C1: each accepted message triggers up to three LLM/web-search calls with no ceiling.
- **`/api/beta-signup`** — public and unauthenticated, and every call invokes `notifyAdmin("beta_signup", …)`, which **sends an email to the admin**. Unlike the login path, this notification has **no dedup**. A script iterating unique emails floods the admin inbox and grows `BetaSignup` unbounded.
- **Magic-link send** — repeated submissions for a known/allowlisted address send a fresh sign-in email each time (inbox flooding of a real user); submissions for unknown addresses generate admin notifications (these *are* deduped per 24h, which limits but doesn't remove the noise).

**Attacker scenario.** Cheap, unauthenticated resource and cost exhaustion: burn Anthropic budget via inbound, bomb the admin mailbox via beta-signup, or spam a target user's inbox with login emails.

**Remediation direction.** Add per-IP (and, where a token exists, per-token) rate limiting on `/api/inbound`, `/api/beta-signup`, and the sign-in send. Add dedup/throttle to the `beta_signup` admin notification the same way the allowlist-rejection path already does. A cap on LLM calls per account per window bounds the worst-case spend even if a token leaks.

---

## MEDIUM

### M1 — Admin is BCC'd on every user's sign-in email, which contains a live magic link — ✅ RESOLVED, owner-verified live 2026-07-17
**Class:** Authentication / Authorization (blast radius)
**Location:** `lib/magicLinkRateLimit.ts` (moved here from `auth.ts` by the unrelated H1 Phase 3 refactor, `903a9eb`, 2026-07-16 — the bcc itself was not touched by that commit, only relocated).

**Resolution.** The `bcc: process.env.ADMIN_EMAIL` on the sign-in send is removed. The admin now gets a separate notification — `notifyAdmin(..., "magic_link_sent", email)`, persisted as an `AdminNotification` row via the existing pattern — that identifies who signed in and when, and deliberately contains no url, token, or any part of the link:
- `buildSignInEmailPayload()` — pure function, the user's email payload; has no `bcc` field.
- `buildSignInAdminNotification({ email, signedInAt })` — pure function, returns `{ subject, body }` with no link/url/token, only the email address and an ISO timestamp.

A compromised admin mailbox can no longer be escalated into completing login as an arbitrary user — the worst it now leaks is *that* and *when* someone signed in, not a usable credential.

**Verified:** unit tests (`__tests__/magicLinkRateLimit.test.ts`) assert the user-facing payload has no `bcc` key, the admin payload contains neither the test URL nor its token, and a non-allowlisted sign-in attempt (which never reaches the send path) triggers no `magic_link_sent` notification. 359 tests passing, `npm run build` clean. Per this project's "no jsdom" component-testing philosophy, both send-payload builders are pure functions tested directly, not through a mocked DOM.

**Owner-verified live in production, 2026-07-17:** a second allowlisted user signed in successfully; the admin mailbox received the `magic_link_sent` notification with no link present, and received no sign-in email at all. Independently confirmed at the data layer too — the persisted `AdminNotification` row was queried directly (not just the test suite): `deliveryStatus: "sent"`, body contains no `http://`/`https://`. Closed.

**Original finding, for reference.** Every user's sign-in email — magic link included — was copied to the admin mailbox. Anyone with access to that inbox (a mailbox breach, a forwarding rule, a shared/again-BCC'd address) could obtain working sign-in links for arbitrary users and complete login *as that user*, racing the real user for the single-use link. Rated Medium, not higher, because the link is single-use/time-limited and a legitimate admin already has broad visibility through the admin pages — the marginal risk was specifically the *expansion of an admin-mailbox compromise into full user impersonation*.

### M2 — AI-extracted "return portal" URL is surfaced as a trusted link (phishing via prompt injection)
**Class:** Prompt injection / XSS-adjacent
**Location:** `lib/extract.ts` (`returnPortalUrlFromEmail`, `normalizeReturnPortalUrl`), rendered at `app/(app)/orders/[id]/page.tsx` (`<a href={order.returnPortalUrl}>`) and opened by `app/StartReturnButton.tsx` (`window.open(returnPortalUrl, …)`).

**What it is.** The extractor pulls a "return policy / start-a-return" URL out of email content and the app later renders it as the prominent **"Start a return"** action. The value ultimately derives from attacker-influenceable email text. This is **not** script-execution XSS — there is no `dangerouslySetInnerHTML`, React escapes the attribute, `window.open` uses `noopener,noreferrer`, and `normalizeReturnPortalUrl` prepends `https://` which incidentally defuses `javascript:`/`data:` payloads. The residual risk is **phishing**: a `https://evil.example/…` link chosen by the attacker gets presented with Return Window's trust chrome as the official place to start a return. Chained with C1 (inbound injection), the attacker doesn't even need the victim to forward anything.

**Remediation direction.** Treat AI-sourced URLs as untrusted: display the resolved domain to the user, don't auto-open, and/or constrain to the retailer's own domain (or a vetted list) before presenting it as "the" return link. Mark web-lookup/email-sourced links visibly as unverified.

### M3 — `ADMIN_SECRET` travels in the URL query string; comparison isn't constant-time
**Class:** Authentication
**Location:** `app/admin/page.tsx` (`?secret=`), `lib/adminAuth.ts` (`secret === expected`).

**What it is.** The admin dashboard is gated by `?secret=<ADMIN_SECRET>`. Secrets in URLs leak through server/access logs, browser history, and the `Referer` header on any outbound navigation from the page. Separately, `isValidAdminSecret` uses `===`, a non-constant-time compare. (Note: the more sensitive per-user admin views correctly use an identity gate instead, which is good — this applies to the shared-secret dashboard and its approve/split actions.)

**Remediation direction.** Move the admin gate to the same session identity check the `/admin/users/*` pages already use (`ADMIN_USER_EMAIL`), retiring the query-string secret. If a shared secret must remain, pass it in a header/cookie rather than the URL and compare with `crypto.timingSafeEqual`.

### M4 — Sensitive email content logged in plaintext despite at-rest encryption
**Class:** Data exposure
**Location:** `app/api/inbound/route.ts` — `console.log("Inbound email payload:", JSON.stringify(payload))`; also the Gmail-verification branch emails the full raw body to the admin.

**What it is.** Email bodies, sender addresses, and subjects are encrypted at rest (`lib/emailEncryption.ts`, AES-256-GCM — good), but the full inbound payload is written to function logs in cleartext, and admin summaries/verification emails carry user emails and raw bodies. This undercuts the app's own data-minimization posture and puts PII into a log/inbox retention path that the encryption was meant to avoid. (This aligns with the project's own "minimize real user data in written artifacts" rule in `CLAUDE.md`.)

**Remediation direction.** Drop or redact the full-payload log line (routing metadata only), and trim raw bodies out of admin notifications. Keep verbose logging behind a debug flag that's off in production.

---

## LOW / informational

- **L1 — Cron secret also accepted as `?secret=` query param.** `app/api/cron*/route.ts` `isAuthorized()` accepts either an `Authorization: Bearer` header (preferred, what Vercel Cron sends) *or* `?secret=`. The query-param path shares M3's URL-logging weakness. Direction: keep only the header path in production.
- **L2 — Middleware matcher has drifted from the real auth boundary.** `proxy.ts` matches `/`, `/orders/*`, `/emails/*`, `/settings` but not `/alerts` or `/admin`. No live exposure today — the `(app)` layout and each page independently call `auth()`, and admin pages have their own gates — but the matcher is now misleading and a future page added under `(app)` that forgot its own check could be exposed if someone trusted the matcher. Direction: gate the route group as a whole, or keep the matcher in sync and documented. (The important `/api/auth/*` exclusion is correctly handled.)
- **L3 — Order PATCH routes rely on cookie `SameSite` for CSRF, not an explicit check.** `PATCH /api/orders/[id]/{archive,delete,status}` are cookie-authenticated JSON endpoints. They're effectively CSRF-safe (non-simple method → preflight; NextAuth session cookie is `SameSite=Lax`), but that safety is implicit. Server actions get framework origin checks; the token routes have explicit nonces. Direction: add an explicit same-origin/`Origin` check to the PATCH handlers for defense-in-depth.
- **L4 — Prompt-injection-driven status changes.** Extracted `refundAmount`/`emailType` can auto-advance an order's `displayStatus` (e.g. a forged "refund" email → order shows refunded). Impact is confined to the victim's own view and reminder suppression, so it's low, but it's the clearest example of extracted content driving control flow. Direction: keep money/status-affecting transitions behind the existing `needsReview` gate for low-confidence or injection-suspect extractions.
- **L5 — RE-RATED 2026-07-17 (was "confined to dev tooling," that claim was false).** The original claim that "runtime deps... came back clean" does not hold: `npm audit --omit=dev` shows `nodemailer` (`^7.0.13`, a **direct** dependency, not dev) carrying a **HIGH**-severity advisory (`GHSA-p6gq-j5cr-w38f`, CVSS 7.1 — the message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess`, enabling arbitrary file read and full-response SSRF) plus several moderate CRLF-injection advisories, and `next`/`postcss` carry a moderate XSS-in-CSS-stringify-output advisory. The dev-tooling-only claim was correct only for the *other* flagged packages (`path-to-regexp`, `tar`, `undici`, `ajv`, `@tootallnate/once`, all genuinely confined to the `vercel` CLI devDependency tree) — it was wrong to generalize that to "runtime deps clean" without checking `nodemailer` specifically.
  **(a) No clean upgrade exists.** `nodemailer@7.0.13` is the newest 7.x release (confirmed via `npm info`) and is still vulnerable to all six advisories — none were backported to the 7.x line; fixes landed only in 8.x (the moderate ones) and `>9.0.0` (the HIGH one). `next-auth@5.0.0-beta.31` (pinned to `@auth/core@0.41.2`) declares nodemailer as an **optional peer dependency at `^7.0.7`** — installing 8.x/9.x requires npm to override that peer contract (confirmed via `npm install nodemailer@9.0.3 --dry-run`, which only succeeds with an `ERESOLVE overriding peer dependency` warning). That's not a supported upgrade path; it runs the Nodemailer provider against a major version next-auth's own beta pin doesn't claim to support.
  **(b) Reachability — verified by tracing the actual code, not by trusting `auth.ts`'s comment.** Our own code never imports `nodemailer` directly (repo-wide grep, zero hits). The *only* code path anywhere in the dependency tree that calls nodemailer's `createTransport`/`sendMail` — the vulnerable surface, including the `raw` option — is `@auth/core`'s `Nodemailer` provider factory's own default `sendVerificationRequest` (`node_modules/@auth/core/src/providers/nodemailer.ts`). Traced how that default gets overridden: `@auth/core`'s provider normalization (`lib/utils/providers.js`'s `parseProviders`) calls `merge(defaults, userOptions, {...})`, and `merge.js` overwrites `target` with each later source's keys — so the `sendVerificationRequest` we pass into `Nodemailer({ sendVerificationRequest, ... })` in `auth.ts` replaces the module's default at provider-initialization time, before any request is handled. No other file in `@auth/core` or `next-auth` calls `createTransport`. Conclusion: nodemailer's vulnerable code is not reachable by any path this application executes, confirmed at the source level.
  **(c) Re-rate: LOW, but a fragile LOW, not a durable one.** Actual exploitability today is zero — confirmed, not assumed. But this LOW rating rests entirely on the override in `auth.ts` never changing and nobody adding a new code path that calls nodemailer directly; it can't be closed by a routine `npm update` since no compatible patched version exists. Given the underlying advisory is HIGH severity (arbitrary file read + SSRF), this is worth a standing tripwire rather than closing the finding outright: revisit if `next-auth` leaves beta (see L6 — a stable release may widen its nodemailer peer range) or if any future change touches the Nodemailer provider config or imports `nodemailer` directly.
  **Direction:** no forced upgrade — it would violate next-auth's own peer contract for no reachable benefit. Continue to exclude Vercel CLI's genuinely-dev-only advisories from urgency. Revisit nodemailer specifically alongside the L6 next-auth-stable upgrade.
- **L6 — `next-auth` is on a beta release (`5.0.0-beta.31`) in production.** The config itself looks correct, but a pre-release auth library means security fixes may land as breaking betas. Direction: track the v5 stable release and plan the upgrade.

---

## Checked and clear (so these aren't "fixed" by mistake)

- **Authorization / IDOR — clean.** Every user-scoped route and server action performs an ownership check (`order.userId !== session.user.id` → 404/return) *after* `auth()`, before any read or mutation. `deleteAllData` scopes `deleteMany` by `userId`. `/api/orders/[id]/status` additionally enforces a status allowlist and a monotonic no-downgrade rule. No horizontal or vertical privilege issue found.
- **SSRF — none found.** The app's only outbound calls are to fixed hosts (Postmark send URL, Anthropic SDK). The return-policy web search runs inside Anthropic's server-side tool, not an app-side fetch; no email-derived URL is ever fetched server-side, and `next/image` remote fetching isn't configured. *Forward-looking:* if a future feature server-side-fetches `returnPortalUrl` (e.g. to preview/validate it), that would introduce SSRF — validate the host first.
- **Stored XSS — none found.** No `dangerouslySetInnerHTML` anywhere; stored email HTML is never rendered raw. Outbound email templates escape all retailer-derived text via `escapeHtml`.
- **Email-action tokens — strong.** HMAC-SHA256, `timingSafeEqual`, 14-day TTL, per-action scoping, single-use enforced by a unique constraint inside a transaction, POST-only (no GET redemption by link-previewers), plus a derived CSRF nonce.
- **Crypto & secrets — strong.** AES-256-GCM with random IV and auth tag; keys/secrets validated by decoded byte length at boot; no secrets committed to the repo (verified).

---

### Suggested order of work
1. **C1** — authenticate the inbound webhook (Postmark Basic Auth / secret) — this is the one genuinely exploitable-at-scale issue.
2. **H1** — ✅ done 2026-07-16 — rate limiting added (inbound, beta-signup, sign-in send) and the beta-signup admin notification deduped. See H1's own entry above for detail.
3. **M1–M4** — M1 ✅ done and owner-verified live 2026-07-17 (see M1's own entry above). Remaining: treat AI URLs as untrusted, move the admin gate off the query string, and stop logging plaintext payloads.
4. **L1–L6** — hardening and hygiene as time allows.

*This audit reviews the code as written; it does not cover Vercel/Postmark/Neon platform configuration (e.g. whether webhook Basic Auth or a WAF is already set at the platform layer), which should be confirmed separately.*

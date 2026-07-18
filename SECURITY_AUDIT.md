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
| `POST /api/inbound` | ✓ Basic Auth (C1, 3/4) | ✓ (token→user) | ✓ (H1, 30/hr per token) | ⚠︎ C2 (proposed) | ✓ | ⚠︎ M2 / L4 | — | ✓ |
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

### C1 — Inbound webhook has no sender verification, and attributes mail by a non-secret token — 🟡 3 of 4 parts resolved, re-scoped 2026-07-17
**Class:** Webhook verification / Authentication / Rate limiting
**Location:** `app/api/inbound/route.ts`; token model in `prisma/schema.prisma` (`inboundToken String @unique @default(cuid())`); `lib/inboundAddress.ts`

**Status of the four original remediation parts, individually — not collapsed into one verdict:**
1. **Authenticate the webhook itself — ✅ done.** `isInboundWebhookAuthorized()` (HTTP Basic Auth, constant-time compare) gates the handler before `request.json()` is ever called. Confirmed live in production via direct `curl` (401 without credentials) and via `INBOUND_WEBHOOK_USER`/`INBOUND_WEBHOOK_PASSWORD` present in Vercel production env.
2. **Separate the routing token from the webhook secret — ✅ done.** `INBOUND_WEBHOOK_USER`/`PASSWORD` are distinct env vars from `inboundToken`; the token still routes mail to a user, the Basic Auth pair now separately proves the *request* came from Postmark.
3. **Rotate `inboundToken` to high entropy — re-assessed below; likely the wrong remaining fix.**
4. **Rate limit — ✅ done via H1** (30 messages/hour per token).

**Re-assessing part 3 — the premise tested, not assumed.**

**(a) Actual residual attack, with Basic Auth live.** Forging a webhook POST is closed — an attacker can no longer fabricate a Postmark-shaped payload and send it directly to `/api/inbound`. What remains is exactly what the address is *for*: anyone who knows (or otherwise obtains) a user's forwarding address can **email** it, and Postmark will legitimately relay that message to our webhook with valid Basic Auth credentials (Postmark is the caller, not the attacker). This is a narrower vector than the original "wide-open POST endpoint, zero knowledge needed" framing — it now requires knowing a specific address — but the address is semi-public by design (shown in Settings, typed into Gmail filters, pasted around by users), so that precondition is a low bar, not a strong one.

**(b) Is a forged sender trivially injectable? Confirmed yes — this was the main suspicion, and it's real, not killed.** Checked the actual `PostmarkInboundPayload` interface and every line of `app/api/inbound/route.ts`: there is no `SpfResult`/`DkimResult`/`Authentication-Results`/`Headers` field anywhere in the interface, and no code path reads or checks sender authentication at all. The only gate is whether `extractInboundToken(payload)` resolves to a `User` — completely independent of whether the email's `From:` was spoofed. **This means Basic Auth protects the Postmark→our-webhook leg, but nothing protects the sender→Postmark leg** — a forged-sender email crafted by anyone who knows an address, if accepted by Postmark's own inbound MX, is relayed to us and trusted exactly as if it were genuine. Whether Postmark's own inbound processing rejects failed-SPF/DKIM mail before it ever reaches our webhook is platform configuration, not visible from this codebase — see (f).

**(c) Chain analysis — what does trusted-but-forged mail actually reach?** Anything that resolves a valid token flows straight into `isCommerceEmail(...)` → `runExtraction(...)` → `lib/linkOrder.ts`, with no sender-authenticity signal anywhere in that path. Concretely it reaches: **M2** (a forged email can set `returnPortalUrl`, rendered as the trusted "Start a return" link/button with the app's own chrome) and **L4** (a forged refund/return email can auto-advance `Order.displayStatus`, including to `refunded`, which auto-archives and stops all future reminders). Both were already-identified findings; this closes the loop on *how* an attacker reaches them without needing C1's original "forge the whole POST" capability at all — email is a fully sufficient delivery mechanism on its own. **The real residual is "we trust anything that arrives" (b), not "the address is guessable."**

**(d) Entropy, quantified — not restated as an adjective.** Verified the actual generator against `package.json`: there is no standalone `cuid` dependency; `@default(cuid())` is Prisma's built-in generator, and decompiling `node_modules/@prisma/client/runtime/client.js` confirms it's the classic CUID v1 algorithm: `"c" + timestamp(base36 ms) + counter(4 base36 chars) + fingerprint(4 chars: 2 from process PID, 2 from a hostname checksum) + random(8 base36 chars, two `Math.random()`-seeded draws)`.
   - **Timestamp:** not secret — it's a monotonic, publicly-inferable value (roughly bounded by "when did this user sign up"). Contributes to raw brute-force search cost for a fully blind attacker, but zero bits of genuine *unguessable* entropy.
   - **Counter:** effectively deterministic for `inboundToken` specifically. The generator is a single process-wide singleton (`i` increments across *every* `cuid()` call in that process); `User.id` is declared before `inboundToken` in the schema and is itself a `cuid()` default, so in a fresh process `id` consumes counter value 0 and `inboundToken` consumes value 1 — i.e. `inboundToken`'s counter segment lands on the same fixed value for essentially every user, regardless of signup date. This fully explains the pattern in the redacted sample (identical counter segment across users who signed up on different days) without needing to query production to confirm it. ~0 bits.
   - **Fingerprint:** derived from process PID + a hostname checksum — infrastructure-scoped, not per-user. The redacted sample showed the same fingerprint segment across all three users, including across two different signup days (i.e., across what were almost certainly different container cold-starts) — consistent with Vercel's serverless containers for this app landing on a narrow, low-variance set of PID/hostname combinations. Treat as ~0 bits empirically; not provably exactly 0 without a larger sample, but not a meaningful contributor.
   - **Random block — the only genuine entropy.** Two independent `Math.random()`-seeded draws, each uniform over `[0, 36^4)`. That's `2 × log2(36^4) ≈ 41.4 bits` — **≈2.8 × 10¹² (2.8 trillion) possible values**, even in the attacker-favorable case where the exact timestamp, counter, and fingerprint are already known.
   - **Guesses to hit a live token at current scale (13 users):** ≈ 2.8×10¹² ÷ 13 ≈ **2.2 × 10¹¹ (≈220 billion) guesses expected**, and that's the *best case* for an attacker — it assumes they've already pinned the exact millisecond timestamp, which in practice they haven't, making the real search space larger still. There is also **no oracle**: guessing a token means actually sending a real email and getting no signal back about whether it landed — this isn't a login form an attacker can hammer and read pass/fail from; blind brute force here is both computationally and operationally infeasible at any realistic scale.

**Conclusion on part 3: entropy is not the bottleneck, and "rotate `inboundToken` to high entropy" is very likely the wrong remaining fix.** ~41 bits with no attacker oracle is not a practically exploitable gap — the original audit's "CUIDs aren't secret-strength" language was true but unquantified, and the quantified answer says this isn't where the risk lives. Recommend killing token rotation as a priority and redirecting that effort at (b) instead — see the new finding below.

**(e) If rotation is still done anyway** (e.g. defense-in-depth, not urgency): scope it as a migration, not a fix. `inboundToken` is the user's literal forwarding address — already typed into live Gmail filters. A hard cutover breaks every existing user's forwarding silently. Use the same dual-resolution pattern already proven by the `postmarkapp.com` → `mail.myreturnwindow.com` domain migration (old and new both resolve simultaneously; nothing breaks until every user has been migrated and given time to update, if ever).

**(f) The one remaining unknown — narrowed, not left open.** Whether Postmark's dashboard is configured with the Basic Auth credentials is platform config, unverifiable from this repo alone (see C1's earlier resolution note). However: H1 Phase 1's live verification on 2026-07-16 — a real forwarded test email landing in the dashboard, confirmed via Postmark's own activity log — happened *after* the Postmark webhook URL was updated with credentials on 2026-07-15. If Postmark weren't presenting matching credentials, that request would have 401'd and never reached processing. This is strong circumstantial evidence the platform config is correct, not proof, but it should no longer be treated as a flat "unknown" — it's a "very likely correct, confirm directly in the Postmark dashboard if certainty is needed."

**New finding proposed, not folded into C1:** the real residual gap is **no sender authentication on inbound mail** — see proposed **C2** below. C1 itself is now 3-of-4 resolved with the 4th part (entropy rotation) recommended *against* as low-value; C1 should not carry an open/unresolved marker once C2 is accepted as its own tracked finding.

---

### C2 — [PROPOSED, not yet accepted] Inbound processing trusts sender identity unconditionally — no SPF/DKIM/authentication check
**Class:** Webhook verification / Email authentication
**Location:** `app/api/inbound/route.ts` (`PostmarkInboundPayload` interface has no authentication-result field; `POST` handler never reads or checks one)

**What it is.** Once a request passes Basic Auth (proving it came from Postmark) and resolves a valid `inboundToken` (proving which user it routes to), **nothing checks whether the email's claimed sender is genuine.** No SPF result, no DKIM result, no `Authentication-Results` header, no domain allowlist for expected senders (e.g. "does this claim to be from an address that plausibly sends order confirmations"). Any email that Postmark's own inbound MX accepts — regardless of spoofed `From:` — is relayed to us with valid credentials and processed identically to a genuine forwarded order email.

**Attacker scenario.** An attacker who knows or obtains a user's forwarding address (see C1(a) — a low bar, since the address is semi-public by design) sends a forged-sender email — e.g. spoofing `returns@nordstrom.com` — directly to that address. If Postmark's own inbound processing doesn't independently reject it (platform config, unconfirmed — see C1(f)), it lands exactly as a genuine forward would: extraction runs, a fabricated order or fake refund confirmation can be created, `Order.displayStatus` can auto-advance to `refunded` (L4, silently killing future reminders), and a malicious `returnPortalUrl` can be presented as the trusted "Start a return" action (M2). This reproduces the full impact of the original C1 attacker scenario without needing to forge the webhook request at all — email was always a sufficient delivery mechanism, C1's fix only closed the non-email delivery path.

**Why proposed as CRITICAL, pending your call.** No sophisticated exploit is required (a spoofed `From:` header is trivial), the precondition (knowing an address) is low-effort given the address's semi-public design, and the impact chains directly into two already-documented findings (M2, L4) plus the original C1 cost-exhaustion concern (each accepted email still fans out to a Haiku classify call, a Sonnet extraction call, and up to three web-search calls). Rate limiting (H1, 30/hr/token) bounds the *rate* but not the *validity* of what's accepted.

**Remediation direction.** Confirm what Postmark's inbound payload actually exposes for this account (likely a raw `Headers` array carrying `Received-SPF`/`Authentication-Results` when the receiving MTA performs the check) — this needs a real payload inspection or Postmark dashboard/doc check, not assumed from this codebase. If available, parse and check it before treating mail as trustworthy; at minimum, flag SPF/DKIM-fail mail as `needsReview` rather than silently trusting it, consistent with L4's existing direction. If Postmark doesn't surface this at the current plan tier, that's a platform/vendor question, not a code fix.

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
  **Update 2026-07-18 (`3f5677f`):** the `needsReview` gate this direction references now also fires when a `return_label`/`refund` email links to an order already in a manual terminal state (`kept`) — a partial, related strengthening (flag-only, does not alter `displayStatus` auto-advance, which remains L4's core concern). Logged here per the same-commit rule; `3f5677f` predates this note, which is the reconciliation catch-up.
- **L5 — RE-RATED 2026-07-17 (was "confined to dev tooling," that claim was false).** The original claim that "runtime deps... came back clean" does not hold: `npm audit --omit=dev` shows `nodemailer` (`^7.0.13`, a **direct** dependency, not dev) carrying a **HIGH**-severity advisory (`GHSA-p6gq-j5cr-w38f`, CVSS 7.1 — the message-level `raw` option bypasses `disableFileAccess`/`disableUrlAccess`, enabling arbitrary file read and full-response SSRF) plus several moderate CRLF-injection advisories, and `next`/`postcss` carry a moderate XSS-in-CSS-stringify-output advisory. The dev-tooling-only claim was correct only for the *other* flagged packages (`path-to-regexp`, `tar`, `undici`, `ajv`, `@tootallnate/once`, all genuinely confined to the `vercel` CLI devDependency tree) — it was wrong to generalize that to "runtime deps clean" without checking `nodemailer` specifically.
  **(a) No clean upgrade exists.** `nodemailer@7.0.13` is the newest 7.x release (confirmed via `npm info`) and is still vulnerable to all six advisories — none were backported to the 7.x line; fixes landed only in 8.x (the moderate ones) and `>9.0.0` (the HIGH one). `next-auth@5.0.0-beta.31` (pinned to `@auth/core@0.41.2`) declares nodemailer as an **optional peer dependency at `^7.0.7`** — installing 8.x/9.x requires npm to override that peer contract (confirmed via `npm install nodemailer@9.0.3 --dry-run`, which only succeeds with an `ERESOLVE overriding peer dependency` warning). That's not a supported upgrade path; it runs the Nodemailer provider against a major version next-auth's own beta pin doesn't claim to support.
  **(b) Reachability — verified by tracing the actual code, not by trusting `auth.ts`'s comment.** Our own code never imports `nodemailer` directly (repo-wide grep, zero hits). The *only* code path anywhere in the dependency tree that calls nodemailer's `createTransport`/`sendMail` — the vulnerable surface, including the `raw` option — is `@auth/core`'s `Nodemailer` provider factory's own default `sendVerificationRequest` (`node_modules/@auth/core/src/providers/nodemailer.ts`). Traced how that default gets overridden: `@auth/core`'s provider normalization (`lib/utils/providers.js`'s `parseProviders`) calls `merge(defaults, userOptions, {...})`, and `merge.js` overwrites `target` with each later source's keys — so the `sendVerificationRequest` we pass into `Nodemailer({ sendVerificationRequest, ... })` in `auth.ts` replaces the module's default at provider-initialization time, before any request is handled. No other file in `@auth/core` or `next-auth` calls `createTransport`. Conclusion: nodemailer's vulnerable code is not reachable by any path this application executes, confirmed at the source level.
  **(c) Re-rate: LOW, but a fragile LOW, not a durable one.** Actual exploitability today is zero — confirmed, not assumed. But this LOW rating rests entirely on the override in `auth.ts` never changing and nobody adding a new code path that calls nodemailer directly; it can't be closed by a routine `npm update` since no compatible patched version exists. Given the underlying advisory is HIGH severity (arbitrary file read + SSRF), this is worth a standing tripwire rather than closing the finding outright: revisit if `next-auth` leaves beta (see L6 — a stable release may widen its nodemailer peer range) or if any future change touches the Nodemailer provider config or imports `nodemailer` directly.
  **(d) 2026-07-17 follow-up — the invariant this LOW depends on is now written down where a future session will actually hit it.** Two commits in two days (`903a9eb`, `505c7fb`) touched the exact `sendVerificationRequest` function this finding depends on, for unrelated reasons, without either one recording that it's load-bearing for a security rating. Documented in `BUILD.md`'s Security invariants and as inline comments at both the override site (`lib/magicLinkRateLimit.ts`) and the wiring site (`auth.ts`'s `Nodemailer({ sendVerificationRequest, ... })` call). No automated guard exists yet — proposed options (boot-time assertion that the wired function is ours, not `@auth/core`'s default; an ESLint rule banning direct `nodemailer` imports outside this file) are recorded in `TASKS.md`'s Next section, not yet built.
  **L5 ⇄ L6 coupling:** L5's *real* resolution — a clean, in-contract nodemailer upgrade — is downstream of L6. `next-auth`'s beta pin (`^7.0.7`) is specifically what blocks it; nothing else does. Whoever picks up L6 (tracking `next-auth` v5 stable) should check whether the stable release widens its nodemailer peer range — if so, L5 may become closable with a routine upgrade instead of remaining a permanently-fragile LOW.
  **Direction:** no forced upgrade — it would violate next-auth's own peer contract for no reachable benefit. Continue to exclude Vercel CLI's genuinely-dev-only advisories from urgency. Revisit nodemailer specifically alongside the L6 next-auth-stable upgrade.
- **L6 — `next-auth` is on a beta release (`5.0.0-beta.31`) in production.** The config itself looks correct, but a pre-release auth library means security fixes may land as breaking betas. Direction: track the v5 stable release and plan the upgrade. **Coupled to L5 (2026-07-17):** `next-auth`'s beta pin on `nodemailer@^7.0.7` is the specific thing blocking a clean upgrade off the vulnerable nodemailer line — check the stable release's nodemailer peer range as part of this upgrade; it may unblock L5 for free.

---

## Checked and clear (so these aren't "fixed" by mistake)

- **Authorization / IDOR — clean.** Every user-scoped route and server action performs an ownership check (`order.userId !== session.user.id` → 404/return) *after* `auth()`, before any read or mutation. `deleteAllData` scopes `deleteMany` by `userId`. `/api/orders/[id]/status` additionally enforces a status allowlist and a monotonic no-downgrade rule. No horizontal or vertical privilege issue found.
- **SSRF — none found.** The app's only outbound calls are to fixed hosts (Postmark send URL, Anthropic SDK). The return-policy web search runs inside Anthropic's server-side tool, not an app-side fetch; no email-derived URL is ever fetched server-side, and `next/image` remote fetching isn't configured. *Forward-looking:* if a future feature server-side-fetches `returnPortalUrl` (e.g. to preview/validate it), that would introduce SSRF — validate the host first.
- **Stored XSS — none found.** No `dangerouslySetInnerHTML` anywhere; stored email HTML is never rendered raw. Outbound email templates escape all retailer-derived text via `escapeHtml`.
- **Email-action tokens — strong.** HMAC-SHA256, `timingSafeEqual`, 14-day TTL, per-action scoping, single-use enforced by a unique constraint inside a transaction, POST-only (no GET redemption by link-previewers), plus a derived CSRF nonce.
- **Crypto & secrets — strong.** AES-256-GCM with random IV and auth tag; keys/secrets validated by decoded byte length at boot; no secrets committed to the repo (verified).

---

### Suggested order of work
1. **C1** — ✅ 3 of 4 parts done 2026-07-15/16 (webhook Basic Auth, token/secret separation, rate limiting). 4th part (entropy rotation) re-assessed 2026-07-17 and recommended *against* — see C1's own entry for the quantified reasoning. **C2 (proposed)** — no sender authentication on inbound mail — is the actual highest-priority open item now; awaiting a decision on whether to accept it as tracked.
2. **H1** — ✅ done 2026-07-16 — rate limiting added (inbound, beta-signup, sign-in send) and the beta-signup admin notification deduped. See H1's own entry above for detail.
3. **M1–M4** — M1 ✅ done and owner-verified live 2026-07-17 (see M1's own entry above). Remaining: treat AI URLs as untrusted, move the admin gate off the query string, and stop logging plaintext payloads.
4. **L1–L6** — hardening and hygiene as time allows; L5 re-rated 2026-07-17 (see its own entry).

*This audit reviews the code as written; it does not cover Vercel/Postmark/Neon platform configuration (e.g. whether webhook Basic Auth or a WAF is already set at the platform layer), which should be confirmed separately.*

# Body-text call-site inventory — resolveBodyText() vs. raw field reads

**Date:** 2026-09-06 (task drafted 2026-09-05). **TASKS.md 🔴 Now item:** "Inventory:
which email-body parsing call sites in the repo go through resolveBodyText() vs. read
raw fields directly?" (sequenced after Item A, shipped `c30c9fc`).

**Method:** read-only code inspection. Zero model calls, zero DB writes, zero runtime.

---

## Correction to the task's own citation

The task description that spawned this item cited HISTORY.md's **2026-06-29** and
2026-08-23 entries as "the two prior HTML-vs-text fixes that established the
precedent." That citation is wrong: the **2026-06-29** entry (`d35b19e`) is "Archive +
soft-delete for orders" — unrelated to body-text handling. The actual precedent chain
is:

- **~2026-05-28** — "Commerce gate body handling fix" (`ffb42be`) — `lib/classify.ts`'s
  home-rolled HTML stripper left tag/style soup in place for large HTML-only emails.
- **~2026-06-01** — "Extraction fallback to htmlBody" (`ffb42be`) — created
  `resolveBodyText()` in `lib/emailBodyText.ts` itself: `textBody` first, fall back to
  `html-to-text(htmlBody)` when `textBody` is empty/thin.
- **2026-08-23** — H&M `return_label` order-number gap (`efd4f43`) — added
  `resolveBodyTextWithAlternate()`, the two-pass-retry variant, without changing
  `resolveBodyText()`'s existing default for any caller.

This is a factual correction, not an editorial one — flagged here so a future reader
isn't confused about why this doc's precedent list differs from Item B's TASKS.md
description. **TASKS.md itself was not edited as part of this task** (out of scope,
owner-only edit) — the owner should decide separately whether to correct Item B's text.

---

## Scope

Main table covers `lib/` and `app/` — the app's actual runtime code. `scripts/` is
footnoted, not inventoried row-by-row (see below); two spot-checks confirmed nothing
there is promoted to production:

- No `scripts/cron/` or `scripts/production/` subdirectory exists.
- Nothing under `scripts/` is referenced by any `package.json` script or by
  `vercel.json`'s `crons` array — every cron job runs through an `app/api/cron/*`
  route, already in scope.

Tests (`**/*.test.ts`) excluded per the task spec — no test hid a raw-read pattern
that isn't already visible in its production call site.

`lib/emailBodyText.ts` is the implementation under audit, not a call site — excluded
by definition, per the task spec.

**Two internal wrapper functions are called out but not double-counted as separate
call sites:** `lib/trackingParser.ts`'s `parseTrackingResolved()` (line 195) and
`lib/classify.ts`'s `isCommerceEmail()` (line 35) each call `resolveBodyText()`
internally, but they're themselves *consumed* by other call sites (`linkOrder.ts`,
`app/api/inbound/route.ts`) that are the actual points where raw fields enter
processing — counting both ends of the same pipeline would double-count. Both wrappers
route to the helper either way, so this doesn't change any row's verdict.

---

## Search-strategy note: a real gap in the task's own grep spec

The task's Pass 1 grep (`textBody`/`htmlBody`, case-sensitive) misses the inbound
Postmark webhook payload's own field names, which are **PascalCase** (`TextBody`,
`HtmlBody`) — matching Postmark's wire format, not the Prisma `Email` model's
lowercase columns. `app/api/inbound/route.ts` reads `payload.TextBody`/
`payload.HtmlBody` in five places; a case-sensitive-only grep against the lowercase
spec would have silently missed all of them, including the one confirmed latent gap
found in this inventory (#11 below). Re-ran Pass 1 case-insensitively for `*Body`
patterns to catch this.

**Also a source of false positives:** `textBody`/`htmlBody` are also used as generic
parameter names for **outbound** email composition (`lib/postmark.ts`'s `sendEmail()`,
`lib/magicLinkRateLimit.ts`, `lib/refundCheckin.ts`, and the three
`app/api/cron/*/route.ts` reminder/digest routes) — these build emails Return Window
*sends*, unrelated to reading the `Email` model's *received* content. Excluded from
the table; noted here so a future re-run of the grep isn't surprised by the same
false-positive shape.

---

## Call sites

| # | File | Line | What the call site does with the body | Uses helper? | Judgment |
|---|---|---|---|---|---|
| 1 | `lib/linkOrder.ts` | 177–179 | `applyFallbackOrderDate`: decrypts `textBody`/`htmlBody`, resolves via helper, parses a forwarded-header `Date:` line for the orderDate fallback | `resolveBodyText` | helper |
| 2 | `lib/linkOrder.ts` | 443–445 | `applyShippingTracking`: decrypts, calls `parseTrackingResolved()` for shipping-tracking extraction | `parseTrackingResolved` (wraps `resolveBodyText`) | helper |
| 3 | `lib/linkOrder.ts` | 476–478 | `applyReturnTracking`: decrypts, calls `parseTrackingResolved()` for return-tracking extraction | `parseTrackingResolved` (wraps `resolveBodyText`) | helper |
| 4 | `lib/trackingParser.ts` | 195 | `parseTrackingResolved()` itself — the wrapper consumed by #2/#3; resolves text before handing it to `parseTracking()` | `resolveBodyText` | helper |
| 5 | `lib/runExtraction.ts` | 32–34 | Decrypts, calls `resolveBodyTextWithAlternate()`, feeds primary + alternate into AI extraction (H&M two-pass retry) | `resolveBodyTextWithAlternate` | helper |
| 6 | `lib/classify.ts` | 34–35 | `isCommerceEmail()` — resolves body via helper to decide the Haiku commerce-classification gate | `resolveBodyText` | helper |
| 7 | `app/api/inbound/route.ts` | 104 | `resolveAnchorDate` input: resolves raw webhook payload to find a forwarded-header anchor date at ingestion time | `resolveBodyText` | helper |
| 8 | `app/api/inbound/route.ts` | 355 | Calls `isCommerceEmail(payload.TextBody, payload.HtmlBody)` — raw webhook fields routed through the helper indirectly | via `isCommerceEmail` → `resolveBodyText` | helper |
| 9 | `app/api/inbound/route.ts` (→ `lib/emailEncryption.ts`) | 91–96 (call), 18–19 (impl) | `buildEmailCreateData` → `encryptEmailContent`: stores raw webhook `TextBody`/`HtmlBody` encrypted, byte-for-byte, for persistence | none — by design | raw (intentional) |
| 10 | `lib/emailEncryption.ts` | 18–19, 28–29 | `encryptEmailContent`/`decryptEmailContent`: reads `Email.textBody`/`htmlBody` purely to encrypt/decrypt as opaque ciphertext — never inspects content | none | raw (intentional) |
| 11 | `app/api/inbound/route.ts` | 233 (call), `lib/gmailVerification.ts` 18–32 (impl) | `extractVerificationDetails(payload.TextBody ?? payload.HtmlBody)` — Gmail-forwarding-verification code/link extraction via line-based regex directly on raw body | none — bypasses `resolveBodyText` entirely | **raw (looks like latent gap)** |
| 12 | `app/api/inbound/route.ts` | 255–262 | `notifyAdmin(...)` "Raw email" debug section — dumps `payload.TextBody ?? payload.HtmlBody ?? "(no body)"` verbatim into an admin alert for human reading | none — deliberately raw | raw (intentional) |
| 13 | `lib/adminNotify.ts` | 26–58, 96–103 | `notifyAdmin`/`notifyAdminDeduped`: generic notification-body passthrough parameter — no conditional logic on content anywhere in the file; the only caller feeding it real inbound content is #12 | none — content-agnostic | raw (intentional) |
| 14 | `app/(app)/emails/[id]/page.tsx` | 60, 159–167 | Email detail viewer: `decryptEmailContent()` then renders `email.htmlBody` directly in an iframe `srcDoc` and `email.textBody` as preformatted text | none — deliberately raw | raw (intentional) |

### Summary tally

**14 call sites total** (excluding `scripts/`, tests, and the implementation file
itself): **8 use the helper**, **5 are intentional raw reads**, **1 looks like a
latent gap**.

---

## The one latent-gap finding (#11)

`extractVerificationDetails()` (`lib/gmailVerification.ts`) receives
`payload.TextBody ?? payload.HtmlBody` straight from the inbound webhook handler —
no `html-to-text` conversion, no substantiality check. If a Gmail forwarding
verification email arrives with an empty `TextBody` (the same shape that caused both
confirmed bugs in the 2026-09-04 outbound diagnostic and the 2026-08-23 H&M gap), the
function's line-based regex — looking for a short bare alphanumeric line as the
confirmation code — runs against **untouched HTML markup** instead of readable text,
where it's structurally unlikely to match. This has the same shape as the two
already-fixed gaps: predates the helper's existence in this call path, never
revisited when `resolveBodyText()` was introduced elsewhere.

**Per Item B's scope: this is documented, not fixed.** No code was changed. Whether to
wire this call site through `resolveBodyText()` is an opt-in decision for a separate
session, per the 2026-08-23 precedent this whole inventory follows.

---

## `scripts/` — footnoted, not inventoried

26 files under `scripts/` reference `textBody`/`htmlBody` (or the PascalCase webhook
variants) — all one-off diagnostic, backfill, or investigation scripts accumulated
over the project's history (`pm-diag-*`, `diagnose-*`, `investigate-*`, `backfill-*`,
plus the two `scripts/audits/*` scripts already produced by prior sessions). None are
wired into any recurring or production execution path (see the two spot-checks
above). Listing all 26 individually would misrepresent one-off analysis tooling as
persistent call sites, and would blow past a sane inventory size for what's meant to
document live code paths. Full list is reproducible via the Pass 1 grep below scoped
to `scripts/`.

---

## Methodology (re-runnable, no script — see note below)

```bash
# Pass 1: raw field reads (lowercase Prisma fields + PascalCase webhook fields),
# excluding tests and the implementation file itself.
grep -rnE '\.(textBody|htmlBody|TextBody|HtmlBody)\b' lib app \
  | grep -v -E '\.test\.ts|emailBodyText\.ts'

# Pass 2: helper usage.
grep -rn 'resolveBodyText' lib app | grep -v -E '\.test\.ts|emailBodyText\.ts'
```

**No script was written.** The mechanical part of this inventory — a grep for raw
field reads and a grep for helper usage — is genuinely just those two commands; a
script wrapping them wouldn't reduce work, because collapsing raw grep hits into the
14 logical call sites above required reading each file's surrounding code to
distinguish real inbound-body parsing from lookalikes: outbound email composition
using the same field names (`postmark.ts`, `magicLinkRateLimit.ts`, `refundCheckin.ts`,
the cron routes), a generic notification passthrough (`adminNotify.ts`), and internal
wrapper functions that shouldn't be double-counted against their callers
(`trackingParser.ts`, `classify.ts`). None of that collapsing logic is expressible as
a reusable, re-runnable script without re-encoding this session's domain judgment —
it would need updating by hand every time regardless. The two commands above are
sufficient to reproduce the raw material for a future re-run.

---

## Closing

Conservative read: one real latent gap (#11), structurally identical in shape to the
two already-fixed bugs, but unconfirmed against any live failure — no Gmail
verification email has been observed failing this way, unlike the two confirmed
production cases that motivated Item A. The five "raw (intentional)" call sites are
all either content-agnostic (encryption, generic notification passthrough) or
deliberately show original, un-resolved content to a human (the email detail viewer,
the admin debug dump) — none of them are parsing anything, so routing them through
`resolveBodyText()` would be a category error, not a fix.

This is documentation, not a queue. No sweep-and-replace is recommended. Per Item B's
own scope, any decision to wire call site #11 (or reconsider any other row) through
the helper remains a separate, opt-in, owner-driven decision — not implied or
scheduled by this inventory.

# Postmark → DB ingestion diagnostic — Gap #1RYJR48 3rd email + eBay order

**Date:** 2026-09-07. **TASKS.md 🔴 Now item:** "Diagnostic: emails visible in
Postmark but missing from DB — Gap 3rd email for Order 1RYJR48, plus an eBay
order from same day (2026-09-02)." (Moved from 🟡 Next to 🔴 Now 2026-09-07 to
run this session.)

**Method:** read-only. Postmark inbound Messages API (`GET
/messages/inbound`, `GET /messages/inbound/{id}/details`) via
`POSTMARK_SERVER_TOKEN`, cross-referenced against the `Email` table by
`messageId`, plus a direct in-process replay of the actual
`classifyForwardType()` / `detectSelfOutboundLoop()` functions
(`lib/forwardResolver.ts`, `lib/selfOutboundGuard.ts`) against the real header
payloads Postmark returned for each message. **Zero DB writes. Zero
Anthropic/model calls** — no extraction was re-run on any message. No fix,
reprocessing, or code change was made.

Reusable, read-only scripts (committed alongside this doc):
- `scripts/audits/2026-09-07-postmark-ingestion-diagnostic-queries.ts`
- `scripts/audits/2026-09-07-selfoutbound-headercheck.ts`

---

## Summary verdict

**One bug, not two.** Both cases are the same mechanism: the self-outbound-
loop guard added in commit `22be2d7` (2026-09-03, deployed ~2026-09-04T00:05
UTC) has an over-broad fallback condition (`header_chain_auto_forward` in
`lib/selfOutboundGuard.ts`) that misidentifies **any** Gmail-auto-forwarded
commerce email as a self-outbound loop — not just genuine loops. Both missing
emails were correctly received by Postmark, correctly routed to our webhook,
and then discarded by our own code before an `Email` row was ever created.
This is not an ingestion-arrival problem; it's a false-positive in a guard
added 4 days ago. Evidence for both cases below, plus a wider signal (118
`self_outbound_loop` discards logged 2026-09-04 through 2026-09-06, zero
before the guard's deploy) that this extends well past these two named
orders — see "Follow-ups" at the bottom.

**One correction to the task's framing:** neither missing email is actually
from 2026-09-02. The Gap 3rd email arrived 2026-09-04; the eBay emails found
arrived 2026-09-04 and 2026-09-05. See the date-discrepancy note under Case B.

---

## Case A: Gap #1RYJR48 3rd email

**Order 1RYJR48** belongs to user `mckenna.sweazey@gmail.com`
(`userId cmqtng...`, `inboundToken cmqtng57q0001w9y3sm6r8kog`). The DB holds
exactly 2 linked emails for this order:

| messageId | subject | receivedAt | in DB? |
|---|---|---|---|
| `403fd9fd-8d96-4a0a-b048-4d4fbbd08e00` | Order Confirmation #1RYJR48 | 2026-09-02T17:56:08Z | yes |
| `f967ec9f-c61a-4c07-a9ef-ebef2d0044f0` | An update to your order #1RYJR48 | 2026-09-03T14:59:11Z | yes |

Postmark's inbound stream, searched for this user's `inboundToken` across
2026-09-01–09-04, shows a **3rd** Gap email on the same order thread:

| messageId | subject | receivedAt (Postmark) | in DB? |
|---|---|---|---|
| `3242e727-2da0-4bba-b1ef-1f3bce4b3117` | An update to your order #1RYJR48 | 2026-09-04T19:03:18Z | **no** |

**Postmark record:** exists, `Status: "Processed"`, `BlockedReason: ""` —
Postmark accepted and processed the message normally on its end.

**Did the handler run?** Yes. A `DiscardLog` row with `reason:
"self_outbound_loop"` was written at `2026-09-04T19:03:19.565Z` — one second
after Postmark's received timestamp for this message. `DiscardLog` carries no
`messageId`/`userId` (by design, see schema comment), so this is a strong
timing correlation, not a stored foreign key — but it is corroborated
directly by the code-level test below, which does not depend on timing.

**Where it died:** replaying the actual header payload Postmark returned for
this message through the real `classifyForwardType()` and
`detectSelfOutboundLoop()` functions:

```
3242e727 (MISSING from DB — Gap 3rd email)
  -> forwardType: auto
  -> selfOutboundDetection: { isSelfOutbound: true, reason: 'header_chain_auto_forward' }
```

The same replay run against the headers of the **two emails that did make it
into the DB** (`403fd9fd`, `f967ec9f`) also returns `isSelfOutbound: true`
under today's code:

```
403fd9fd (in DB, order_confirmation)     -> forwardType: auto -> isSelfOutbound: true (header_chain_auto_forward)
f967ec9f (in DB, shipping_confirmation)  -> forwardType: auto -> isSelfOutbound: true (header_chain_auto_forward)
```

The only reason those two are in the DB is that they arrived **before** the
guard existed (commit `22be2d7`, authored 2026-09-03T17:05:20-07:00 =
2026-09-04T00:05:20Z). Both predate that deploy; the 3rd email (2026-09-04
19:03Z) postdates it by ~19 hours and was caught by it.

**Root cause mechanism:** `detectSelfOutboundLoop()`'s third check
(`lib/selfOutboundGuard.ts:75-77`) fires whenever `forwardType === "auto"`
**and** any raw header value contains our own root domain
(`myreturnwindow.com`) as a substring. But for *any* Gmail-auto-forwarded
email routed to this app — which is the app's primary, intended intake path
— Gmail's own `Return-Path` (VERP-encoded) and `X-Forwarded-To`/
`X-Forwarded-For` headers **always** contain `mail.myreturnwindow.com`,
because that is literally the address the mail is being forwarded to. The
condition doesn't distinguish "this is a loop of our own outbound mail" from
"this is completely unrelated commerce mail that happens to be auto-forwarded
to our address" — the latter is true of every legitimate auto-forwarded
email in the system, all the time.

## Case B: eBay order(s)

**Date-discrepancy note:** the task item describes this as "an eBay order
from same day (2026-09-02)." Postmark's inbound stream was searched broadly
(2026-08-25 through 2026-09-07, all recipients, `From`/`Subject` containing
"ebay") and returned exactly 2 messages, **neither dated 2026-09-02**:

| messageId | subject | receivedAt (Postmark) | in DB? |
|---|---|---|---|
| `f3410ac9-a5e5-4ef7-ba55-e46391134d15` | Mckenna, your order is confirmed | 2026-09-05T04:29:38Z (Sep 4, 21:29:38 -07:00) | **no** |
| `6a606aff-49f6-4af1-97d3-97cf49b13a00` | 🚚 Order update: Northland Stainless "Roya..." | 2026-09-05T18:22:59Z (Sep 5, 11:22:59 -07:00) | **no** |

No eBay-domain message of any kind appears in Postmark's inbound stream on
2026-09-02, for any recipient. It's possible the owner's inbox review
recalled the order being *placed* on eBay around 2026-09-02 (an eBay-side
date, not a Postmark-receipt date) — that distinction wasn't checked further,
since it doesn't change the verdict below and is out of scope (no email
content was opened beyond headers/metadata).

**Postmark record:** both exist, both `Status: "Processed"`, no
`BlockedReason`.

**Did the handler run?** Yes, for both — `DiscardLog` rows with `reason:
"self_outbound_loop"` at `2026-09-05T04:29:48.187Z` (10s after
`f3410ac9`'s receipt) and `2026-09-05T18:23:03.376Z` (4s after `6a606aff`'s
receipt).

**Where they died:** same replay test, both from-eBay messages:

```
f3410ac9 (MISSING from DB — eBay order confirmation) -> forwardType: auto -> isSelfOutbound: true (header_chain_auto_forward)
6a606aff (MISSING from DB — eBay order update)       -> forwardType: auto -> isSelfOutbound: true (header_chain_auto_forward)
```

Identical mechanism to Case A: both are Gmail-auto-forwarded to this same
user's inbound address, and both trip the same over-broad
`header_chain_auto_forward` condition.

**Summary line:** all 3 missing emails (1 Gap + 2 eBay) failed at the same
step — the `header_chain_auto_forward` check inside
`detectSelfOutboundLoop()`, called from `app/api/inbound/route.ts` before
`Email.create()` — for the same underlying reason.

---

## Is this one bug or two?

**One.** All 3 missing emails, across 2 different retailers, replay to the
identical `{ isSelfOutbound: true, reason: 'header_chain_auto_forward' }`
result under the same function, and the two known-good emails on the same
order thread replay to the same `true` result under today's code but were
ingested successfully only because they predate the guard's deploy
(`22be2d7`, 2026-09-04T00:05:20Z). The distinguishing variable across all 5
test cases is exclusively **deploy time vs. receipt time**, not retailer,
subject, or content.

---

## Scope note — what this diagnostic did NOT investigate

- No fix was written or proposed in code; this is findings only.
- No reprocessing of any of the 5 messages discussed, or any other message.
- No broader ingestion audit beyond these two named cases and the immediate
  code-level check needed to explain them. The 118-count of
  `self_outbound_loop` discards below is cited only as corroborating
  evidence for the verdict (it shows the discard rate jumping from zero to
  constant at exactly the guard's deploy time) — it is not a full census of
  affected users/orders.
- Did not open or read the body content of the eBay emails, or resolve
  whether "2026-09-02" in the task description refers to an eBay-side order
  date vs. a Postmark receipt date.
- Did not touch the 2026-09-06 retry-trigger fix work (a separate, unrelated
  mechanism in `lib/linkOrder.ts`/`extractEmailIdentity`) — no interaction
  with that item's code, data, or backfill.
- Did not check whether any *other* discard reasons (`non_commerce`,
  `duplicate_messageid`) have similar false-positive issues — out of scope
  for this diagnostic, which was scoped to explaining these two named cases.

## Follow-ups the owner should decide on

- **Blast radius:** `DiscardLog` shows 118 `self_outbound_loop` discards
  between 2026-09-04T00:22:50Z (17 min after the guard's deploy) and
  2026-09-06T23:32:33Z (the query's end of range — likely still ongoing as
  of today, 2026-09-07). `DiscardLog` stores no `messageId`/`userId`, so
  there's no way to retroactively tell how many of those 118 are genuine
  saved loops vs. false-positive-discarded real commerce mail, or how many
  distinct users are affected, without a targeted investigation (e.g.
  correlating Postmark's inbound stream by timestamp the way this diagnostic
  did for 3 known cases, at wider scale).
- **Fix shape:** the `header_chain_auto_forward` condition
  (`lib/selfOutboundGuard.ts:75-77`) needs to be narrowed or removed — it's
  currently indistinguishable from "any Gmail-auto-forwarded email," which
  defeats its own purpose. The two primary checks (`from_domain`,
  `return_path_domain`) don't have this problem — they matched zero real
  commerce mail in this diagnostic's replay.
- **DiscardLog schema:** adding `messageId` (nullable, matching `Email`'s
  own field) to `DiscardLog` would make any future diagnostic like this one
  a direct join instead of a timing-correlation exercise.
- **Retroactive recovery:** none of the discarded originals were saved
  anywhere (by design — `DiscardLog` is content-free). If real orders were
  silently dropped, the underlying emails may only be recoverable from
  Postmark's own retention window (finite) or the user's own inbox — not
  from anything this app stored.

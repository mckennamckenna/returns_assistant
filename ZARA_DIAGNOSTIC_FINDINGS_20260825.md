# Zara retailer fallback — pre-design diagnostic findings (2026-08-25)

Read-only diagnostic answering the six questions from the pre-design brief
(TASKS.md 🔴 Now, Zara entry). 0 billed Anthropic calls — DB reads (Prisma
`findMany`/`findFirst`) and file reads only. No design proposal here; see
`scripts/pm-diag-zara-retailer-fallback-20260825.ts` for the query source.

## Q1 — fromEmail/fromName population on forwarded mail

The Zara order (orderNumber `54421192781`) has no `Order` row at all —
`orderId` is `null` on all three of its `Email` rows, so it's an unlinked
orphan, not a linked order with a null retailer field. The three rows:

| id | emailType | fromEmail | fromName | retailer |
|---|---|---|---|---|
| `cmsyjhrcw0001jm04stofqk35` | shipping_confirmation | `noreply@zara.com` | `Zara` | null |
| `cmt3kvyt60001jy045dr1rh64` | shipping_confirmation | `noreply@zara.com` | `Zara` | null |
| `cmt4ufiua0001jr04p564ts47` | delivery | `noreply@zara.com` | `Zara` | null |

`fromEmail`/`fromName` resolve to **the retailer itself**, not the account
holder's forwarding address and not Postmark — `noreply@zara.com` / `"Zara"`.

Code path (`app/api/inbound/route.ts:90-96`, `buildEmailCreateData`):
`fromEmail: payload.FromFull?.Email`, `fromName: payload.FromFull?.Name` —
read directly off Postmark's `FromFull`, which is the outermost `From:`
header Postmark's inbound MX saw. There is **no parsing of an original
sender out of a forwarded envelope** — `lib/forwardResolver.ts`
(`classifyForwardType`/`resolveAnchorDate`) only classifies forward
mechanism and resolves an anchor *date* from headers/body; it never reads or
returns a sender identity. For Zara specifically this outermost header
happens to already be the retailer's own send address (a "redirect"-style
forward, or Postmark receiving it un-rewritten) — that's the visible signal
the bug report referred to. This is not guaranteed to hold for every
retailer/forwarding-client combination; other rows may have the account
holder's own address as `fromEmail` instead (see Q4's `forwardingShaped`
bucket, though it's nearly empty in the current population).

`retailer` is explicitly barred from using this signal by the extraction
prompt itself: `lib/extract.ts:150` and `:207` — *"retailer (string or null
— from body only, NEVER from the subject line or From header)"* /
*"retailer must NEVER be read from the subject or From header — body
only."* So the current miss isn't a bug in the sense of broken code — the
prompt is doing exactly what it's told, and what it's told deliberately
excludes the one signal that would have resolved Zara. That constraint's
own rationale isn't in scope here to evaluate — it's a pre-existing product
decision the design pass needs to reckon with, not re-litigate blind.

## Q2 — existing forwarding-trust signal (C2 remediation)

**Does not exist in code today.** `SECURITY_AUDIT.md:74-84` (finding
**C2**) describes the flag as accepted-at-LOW with remediation *"narrowed to
a conservative `needsReview` flag... not yet built"* (line 192: *"remediation
narrowed to a conservative `needsReview` flag on unverifiable-sender
forwarded mail, not yet built, low priority given the planned Gmail-OAuth
pivot"*). Confirmed by code: `app/api/inbound/route.ts`'s
`PostmarkInboundPayload` interface has no authentication-result field, and
the `POST` handler never reads or sets any sender-verification signal. Not a
memory error — the plan was written but never landed.

## Q3 — user forwarding-source address storage

Not stored anywhere as a distinct field. `prisma.user` (via a live row read)
has: `id, email, name, emailVerified, image, createdAt, inboundToken,
gmailVerificationCode, gmailVerificationCodeReceivedAt, inboundWindowStart,
inboundWindowCount`. `email` is the account holder's own login/contact
address (used by the Q4 bucketing below), but there is no field for "the
address(es) this user forwards mail *from*" — no per-user allowlist, no
inferred-and-cached forwarding source. If a design wanted to distinguish
"this arrived via the user's own known forwarding path" from "this arrived
from an unrecognized address," that data doesn't exist yet and would be a
net-new prerequisite (schema addition), not a read of existing state.

## Q4 — null-retailer row population, count and shape

**640 of 1200** total `Email` rows have `retailer IS NULL` (as of this run;
population grows continuously). Domain-shape breakdown (heuristic bucketing
— see caveat below):

| bucket | count | emailType breakdown | notes |
|---|---|---|---|
| brandDirect | 416 | other:386, null:22, shipping_confirmation:5, delivery:3 | top domains: larroude.com(63), loyallist.bloomingdales.com(47), em.target.com(43), jonesroadbeauty.com(30) — **includes `myreturnwindow.com`(18), a bucketing artifact, not a real brand** (see caveat) |
| other (ESP-shaped, unmatched by the narrow ESP-hint list) | 221 | other:219, null:2 | top domains: email.bloomingdales.com(163), mail.ralphlauren.com(24), linguafranca.nyc(17) — these are retailer marketing-subdomain sends, not third-party ESP platforms, and my `esp` bucket's hint list was too narrow to catch them |
| esp (matched narrow ESP-hint list) | 2 | other:1, null:1 | marketing.lyst.com, t.shopifyemail.com |
| forwardingShaped (user's own address or Postmark) | 1 | other:1 | gmail.com — essentially absent in the live population |

**Caveat on this bucketing:** it's a quick heuristic for this diagnostic
pass, not a load-bearing classifier — `myreturnwindow.com` (the app's own
inbound/notification domain) fell into `brandDirect` because it matches a
bare-domain regex; a real design would need a cleaner rule. The overwhelming
majority of null-retailer rows are `emailType: "other"` (605 of 640) —
i.e., rows extraction already decided are non-commerce, where a
retailer-name fallback is moot. Only **8 rows** (5 shipping_confirmation + 3
delivery, all in `brandDirect`) are commerce-typed with a genuinely missing
retailer — the Zara triplet is inside that 8. This narrows the practical
fallback surface a lot: the load-bearing case is "commerce-typed email,
direct brand-looking domain, body extraction returned null" — not the bulk
of the 640.

## Q5 — retailer column: Email vs Order

**Both**, independently declared columns (`prisma/schema.prisma:119` on
`Email`, `:214` on `Order`) — not a shared/computed field. Relationship is
**denormalized copy, one-directional, set once at link time**:
`lib/linkOrder.ts:652`, inside the Order-creation path, sets
`retailer: email.retailer` — i.e. Order.retailer is copied from whichever
Email triggered the Order's creation, not independently extracted or kept
in sync afterward. Consequence for Zara: since these three Emails were
never linked (`orderId: null` on all three — no matching Order was ever
created or found), there is no Order row to inherit a retailer value either
way; the null lives only on the Email rows. No other schema location stores
a retailer-name value.

## Q6 — what renders "Unknown retailer" today

A plain `?? "Unknown retailer"` / `|| "Unknown retailer"` null-coalesce on
`order.retailer` (or `row.retailer` in the needs-review row) — no existing
fallback ladder to layer onto; any fromEmail/fromName/domain-derivation
fallback would be new. **12 render sites**, all reading `.retailer` off an
`Order` (or a needs-review row already carrying an Order-shaped `retailer`
field) directly, no shared helper function in between:

- `app/LinkToOrderPicker.tsx:68`
- `app/NeedsReviewRow.tsx:64`
- `app/OrderCard.tsx:132`, `:157`
- `app/(app)/orders/[id]/page.tsx:168`
- `app/admin/users/[forwardingAddress]/orders/[orderId]/page.tsx:145`
- `app/admin/page.tsx:88`
- `app/admin/users/[forwardingAddress]/page.tsx:88`
- `app/action/archive/page.tsx:62`
- `app/action/returned/page.tsx:62`
- `app/api/cron/route.ts:348`, `:357` (digest/reminder text, not UI)
- `app/api/cron/weekly-digest/route.ts:44`, `:75`

All 12 are independent literals, not calls through a shared
`displayRetailer()`-style helper — a fallback ladder implemented once in
`lib/` would need to be threaded through all of them (or the underlying
`retailer` field itself would need to carry the fallback value before it
reaches any of these), not just one call site.

## Close-out

Committed to `main` at repo root: this file +
`scripts/pm-diag-zara-retailer-fallback-20260825.ts`. Not deployed — this is
a read-only diagnostic, no app code changed. 0 billed Anthropic API calls
(confirmed: script uses only `prisma.*.findMany`/`findFirst` and
`decryptEmailContent`; no `runExtraction`/`extractEmail`/model call in the
path). No fix applied, no design proposed — feeds
`ZARA_RETAILER_FALLBACK_DESIGN.md`, to be written next against these
findings.

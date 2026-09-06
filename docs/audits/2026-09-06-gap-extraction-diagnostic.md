# Gap order confirmation extraction diagnostic — #1RYJR48

**Date:** 2026-09-06. **TASKS.md 🔴 Now item:** "Diagnostic: Gap order confirmation
(#1RYJR48, forwarded 2026-09-02) — extraction came back nearly-blank... despite the
viewer showing full order data."

**Method:** read-only Prisma queries + the app's own `decrypt()` helper +
`resolveBodyText()`/`resolveBodyTextWithAlternate()` called read-only, exactly as
production calls them (output never written anywhere here) + source inspection of
`lib/extract.ts`. **Zero writes. Zero Anthropic/model calls.** Re-runnable:
`npx tsx scripts/audits/gap-extraction-diagnostic.ts`.

---

## Summary

The two-pass retry (`efd4f43`, 2026-08-23) never fired for this email, and it isn't a
bug in the retry mechanism itself — it's a gap in the retry's trigger condition. The
primary extraction pass ran against `textBody` (1,049 chars of pure boilerplate: "This
is not your receipt," branding, unsubscribe/view-in-browser links — no order date,
items, prices, totals, or policy anywhere) plus the email `subject`
(`"Order Confirmation #1RYJR48"`, passed to every extraction call regardless of body
content). The model read the order number straight off the subject line and returned
`orderNumber: "1RYJR48"` from pass 1. The retry's sole gate is
`parsed.orderNumber == null` — since pass 1 already had a non-null order number (for a
reason unrelated to the body actually being usable), the retry condition was never
satisfied, so `resolveBodyTextWithAlternate()`'s `alternate` — which, confirmed by this
diagnostic, *does* contain the real order data (total, address, "YOUR ORDER" section)
that `htmlBody` holds — was fetched but never sent to the model at all. Every field
that depends on real body content came back null, and `needsReview` stayed true.

## Step 0 — Chronology

- `email.extractedAt`: `2026-09-05T02:15:51.722Z`
- `efd4f43` (H&M two-pass retry) committed/pushed/deployed: `2026-08-23T16:35:26Z` (per HISTORY.md, "Committed `efd4f43`, pushed, confirmed live")
- Extraction ran **after** the retry code was live (`2026-09-05 > 2026-08-23`) — the retry mechanism was in production at extraction time. Chronology does not explain the failure; ruled out.

## Step 1 — Raw stored fields

Row: `id=cmtkedq300001le04347677sj`, `subject="Order Confirmation #1RYJR48"`, `retailer=Gap`, `emailType=order_confirmation`, `confidence=low`, `needsReview=true`, `orderNumber=1RYJR48`, `orderDate=null`.

- `textBody`: **1,049 chars.** First 500: pure Gap-branding boilerplate — "Order Confirmation: This is not your receipt," a Gap homepage link, and a "view this message... in a web browser" link. No order number, date, items, prices, or policy text anywhere in it.
- `htmlBody`: **92,828 chars.** Standard HTML email template (`<!DOCTYPE html>`, inline styles, `<title>Order Confirmation #1RYJR48</title>`) — the real order content lives here, not in `textBody`.

## Step 2 — `resolveBodyText()` branch

Read `emailBodyText.ts:50-71` and confirmed by running it against the Step 1 values:
`trimmedTextBody` is 1,046 chars after trim — well past `MIN_TEXT_BODY_CHARS` (20) —
so `textSubstantial` is `true` and the function takes the **first branch**: `primary =
trimmedTextBody` (the boilerplate), and since `htmlBody` is present, it also computes
`alternate` from `htmlToPlainText(htmlBody)`. Output confirmed: `resolveBodyText()`
alone returns 1,046 chars of boilerplate — this is exactly what pass 1 saw as `body` in
`runExtraction.ts:34`.

This is the textBody-substantiality check working exactly as designed — 1,046 non-empty
characters clears the "is this real content or an empty iPhone-forward textBody"
threshold. The check has no way to know the 1,046 chars are boilerplate rather than
order data; that distinction requires reading the email, not counting it.

## Step 3 — `resolveBodyTextWithAlternate()` output

- **Primary:** 1,046 chars, identical to Step 2 (the boilerplate `textBody`).
- **Alternate:** 1,723 chars, converted from `htmlBody`. First 500 chars: `"Order
  Confirmation: This is not your receipt.\nCan't see images? Click here.\n...ORDER
  CONFIRMATION\n\n1RYJR48\n\nHi Mckenna,\n\nYour order #1RYJR48 has been
  received.\n\nEstimated Arrival 5-8 Business Days\n...Total $254.14\nApple Pay –
  3093 ($254.14)..."` — this **is** the real order data (order number, delivery
  estimate, shipping address, total, payment method, and further down, presumably the
  "YOUR ORDER (...)" line-item section that gets truncated in this 500-char preview).
  `alternate !== null` — a retry candidate genuinely was offered.
- Confirmed by reading source: `resolveBodyTextWithAlternate()` makes **zero model
  calls**. It's `html-to-text` conversion plus string-length comparisons only — no
  import of `lib/extract.ts`, the Anthropic client, or any network call.

## Step 4 — `runExtraction.ts` / `extractEmailIdentity()` usage

`runExtraction.ts:34-40` calls `resolveBodyTextWithAlternate()` and passes both
`primary` (as `body`) and `alternate` into `extractEmailIdentity(body, subject,
emailId, alternateBody)`. Inside `extractEmailIdentity` (`lib/extract.ts:615-666`):

```
let parsed = await runRawExtraction(textBody, resolvedSubject, emailId, "email_extraction"); // pass 1: boilerplate textBody + subject

const trimmedAlternate = alternateBodyText?.trim() ?? "";
const alternateDiffersFromPrimary = trimmedAlternate.length > 0 && trimmedAlternate !== textBody.trim();
if (
  parsed.orderNumber == null &&        // <-- the sole gate
  parsed.retailer != null &&
  parsed.emailType !== "other" &&
  alternateDiffersFromPrimary
) {
  const retry = await runRawExtraction(trimmedAlternate, ...); // pass 2 would run against the real data
  if (retry.orderNumber != null) {
    parsed = { ...parsed, orderNumber: retry.orderNumber, needsReview: retry.needsReview, notes: `${parsed.notes} Order number recovered from alternate body source on retry.` };
  }
}
```

Pass 1 (against the boilerplate `textBody` + subject `"Order Confirmation
#1RYJR48"`) returned a non-null `orderNumber` — confirmed directly by the stored
`extractionNotes`: *"Retailer identified as Gap from the body branding and customer
service address. **Order number read from subject line.**"* — with no mention of a
retry (the retry's own note-append string, `"Order number recovered from alternate
body source on retry"`, is absent). Since `parsed.orderNumber == null` was `false`
after pass 1, **the `if` block's condition failed and the retry never ran.** `body` is
all pass 1 (and thus the only thing the model ever saw); `alternateBody` was computed,
passed as an argument, and never used. Every field besides `orderNumber` — `orderDate`,
`orderTotal`, `lineItems`, `returnWindowDays` — came back null because the only text
pass 1 had to work with was 1,046 chars containing none of that information; the
subject line has no room for it either.

## Step 5 — Cross-check hypothesis 3 (viewer source)

Read `app/(app)/emails/[id]/page.tsx:54,60,159-167`: the viewer fetches the same
`Email` row via `prisma.email.findUnique({ where: { id, userId } })`, decrypts it with
the same `decryptEmailContent()`, and renders `email.htmlBody` directly in an iframe
`srcDoc`. This is the identical `htmlBody` field and the identical decryption path the
extractor read in Step 1 — confirmed, not a different source. The viewer showing full
order data is expected and consistent with Step 1's finding that `htmlBody` genuinely
contains the real order content; it isn't reading from anywhere the extractor
couldn't also see.

## Verdict

**Something else — closest to a combination of Hypothesis 2 and Hypothesis 4, more
precisely characterized than either stated alone.** The retry mechanism itself is
intact and would have worked (Step 3 confirms the alternate body has real, usable
data). The retry didn't fire (Hypothesis 2's shape: "the 'pass 1 insufficient' signal
doesn't fire for this email shape") — but not because the signal is flaky or
mis-tuned in general. It's because the retry's trigger is scoped narrowly to
`orderNumber == null` (Hypothesis 4's shape: "the H&M fix is narrower than the
inventory treated it as"), and that one field is exactly the field this email's
`subject` line happens to supply for free, independent of whether the body has
anything else. The H&M fix's design assumption — "if pass 1 got an order number, pass
1 had a usable body" — holds for H&M's case (order number embedded in a URL, nothing
in the subject) but not for this Gap case, where the subject alone satisfies the gate
while the body pass 1 actually used is complete boilerplate. Hypotheses 1 and 3 are
ruled out directly: Step 2/3 show `htmlBody`→text conversion did *not* strip the real
data (the alternate output visibly contains order number, total, and address), and
Step 5 confirms the viewer and extractor read the identical stored field.

## Scope note (framing only — not a fix recommendation)

Any fix would need to change what triggers the retry (or what the retry's result is
allowed to backfill) so that a subject-line-only order number no longer counts as
proof the body pass had enough to work with — the two are currently conflated by a
single boolean (`orderNumber == null`) that was sized to H&M's specific failure shape,
not to "primary pass had a usable body" in general. Whatever the mechanism, it would
need to avoid the fix's own stated constraint from 2026-08-23 (only `orderNumber` and
`needsReview` are taken from the retry, "so the existing textBody-preferred default is
unchanged for every other field and every other caller") — broadening what the retry
is allowed to populate is a larger, more consequential change than narrowing when it
triggers, and either direction affects every future email that reaches this call site,
not just Gap-shaped ones.

# Outbound tracking-failure diagnostic — why 12 of 14 return-eligible orders show no tracking

**Date:** 2026-09-04 (run 2026-09-05). **TASKS.md 🔴 Now item:** "Diagnostic: why does outbound tracking fail on 12 of 14 return-eligible orders?"

**Method:** read-only Prisma queries + the app's own `decrypt()` helper + `parseTracking()` called read-only (never writes its result anywhere) + regex/string matching. **Zero writes. Zero Anthropic/model calls.** Re-runnable: `npx tsx scripts/audits/outbound-diagnostic.ts`.

Follows the 2026-09-04 tracking-signal audit's Q1 outbound finding (2/14) and the owner's priority call that returns are more product-critical than incoming.

---

## A correction made during this diagnostic, reported for transparency

The script's first pass used a bare digit-count regex (DHL: 10-11 digits) to re-test HTML-stripped-as-text for a tracking number, and initially flagged 3 orders as "confirmed" parser gaps. Manual verification of each one found:

- **Zara:** the "DHL number" found was `54421192781` — this is literally the Zara **order number** ("Order No. 54421192781" appears verbatim in the email), not a tracking number.
- **The RealReal:** the "DHL number" found was `8017818358` — this is a fragment of a footer boilerplate ID string (`#23-8017818358-6`, alongside `#144088 #000001738 #2670418` etc.), not a tracking number.
- **Julia Amory:** the "UPS number" found (`1ZB796910309638294`) **was verified as real** — confirmed by reading the actual email text: `"UPS tracking number: <a href="https://track.easypost.com/...">1ZB796910309638294</a>"`.

The script was corrected before finalizing this report: bare-digit-count carrier formats (DHL, FedEx) are **not trusted** as confirmed findings from an HTML-stripped-as-text scan — they're reported as "needs manual verification" only. Only distinctive-prefix formats (UPS `1Z...`, and by the same logic Amazon Logistics/OnTrac/LaserShip/UniUni) are trusted as confirmed. This distinction is now built into the committed script (`DISTINCTIVE_CARRIERS`). Flagging this because it's exactly the kind of self-correction the conservative-bias instruction is for — the first-pass numbers were wrong, and shipping them without checking would have misdirected a future fix.

---

## Per-order breakdown (12 orders)

| # | Order | Retailer | Failure mode | Evidence |
|---|---|---|---|---|
| 1 | `cmt9hs6yw...` | Zara | PDF attachment, no other signal | 1 PDF attachment (`...6634171735.pdf`), no carrier link/name anywhere. The digit string that looked DHL-shaped is the order number (see correction above). |
| 2 | `cmrwa2065...` | Ancient Greek Sandals | Generic carrier locator link, no embedded ID | `returnCarrier: DHL` already attributed, but the only DHL link present is `https://locator.dhl.com` — a generic landing page, no tracking ID in the URL or anywhere else in plain text or HTML-stripped text (both re-parses null). A ReturnGO portal link is also present but carries no number either. |
| 3 | `cmroh4a8v...` | Amazon | Amazon no-box return flow — no tracking number in the email, by design | "Drop off by [date] / Dropoff location: UPS Dropoff." UPS appears only as a **drop-off venue name**, never as a tracking link or number. Email offers a "Print return label" link back to Amazon's own authenticated site — the actual label/tracking, if any, lives behind that click-through, not in the email body. |
| 4 | `cms5mgmzk...` | Amazon | Same Amazon no-box flow | Same shape as #3, plus an embedded QR-code image (`trans-qrcode-images-na.s3.amazonaws.com/...png`) for in-store scanning — no tracking number anywhere in the email. |
| 5 | `cmsgcmfr2...` | Julia Amory | **CONFIRMED real parser gap — tracking number present as HTML text, invisible to the pipeline** | `textBody` is 0 characters. The email's HTML contains: `"We received notice that your return was shipped via UPS on Aug 13th, 2026... UPS tracking number: <a href="https://track.easypost.com/...">1ZB796910309638294</a>"`. The href points to an EasyPost redirect (not a recognized carrier domain), so `fromHtmlHrefs()` never matches it — and the actual number sits as the **visible link text**, not the href, so `fromHtmlHrefs()` can't find it there either. `fromPlainText()` never runs on HTML content — it only ever receives the separate `textBody` field, which is empty here. Verified directly: stripping HTML tags and feeding the result through the existing `parseTracking()` plain-text path successfully extracts `carrier: UPS, trackingNumber: 1ZB796910309638294` — the *existing* UPS regex already handles this number; it's simply never shown it. |
| 6 | `cms85t8te...` | Amazon | Same Amazon no-box flow | Same shape as #3. |
| 7 | `cms6rv189...` | NET-A-PORTER | **CONFIRMED real parser gap — same shape as #5** | HTML-stripped-as-text extracts `carrier: UPS, trackingNumber: 1ZX1F4810326874002` — a second real, distinctive-format (1Z-prefix) number sitting as HTML text. A `returnCarrier: DHL` / `https://locator.dhl.com` generic link is also present on this order (same shape as #2) — this order has two independent issues layered together: a real UPS number invisible to the parser, and a decoy DHL locator link with no ID that got attributed first. |
| 8 | `cms89n1cm...` | SSENSE | No return_label email linked, none unlinked either | No `return_label` email exists anywhere in the system for this user+retailer — not an extraction failure, no relevant email was ever received (or it arrived un-typed as something else; not investigated further here, out of scope). |
| 9 | `cmrchi2ul...` | Gap Inc. | Redirect-wrapped link, real destination invisible | Body contains one link, "TRACK MY RETURN," wrapped in a SendGrid click-tracking redirect (`u24515401.ct.sendgrid.net/ls/click?...`). No carrier domain, tracking number, or portal name visible anywhere — the real destination is one hop behind a redirect the pipeline doesn't follow. Same pattern as the redirect-resolution case already logged as deferred in DECISIONS.md (2026-09-04), just a different ESP (SendGrid, not Klaviyo). |
| 10 | `cmrdvrita...` | Ruti | Returns-portal-only link, no visible number | Forwarded email from `shopruti@loopreturns.com`; body says "review your shipping instructions and shipping label by viewing your return" with a link to `api.loopreturns.com/api/redirect/return/...`. No tracking number or carrier name anywhere in the email — Loop Returns generates the label behind an authenticated click-through that was never surfaced via email. |
| 11 | `cmru5i896...` | Amazon | Same Amazon no-box flow (3 linked emails) | Same shape as #3/#4/#6, across 3 separate return_label emails for this order (all showing the same "Drop off by... THE UPS STORE" pattern). |
| 12 | `cmst2keat...` | The RealReal | PDF attachment, no other confirmed signal | `return_packing_slip_RMA835610768.pdf` attached; a bare `www.ups.com` link is present (not confirmed as a tracking link — could be a logo/footer link) but doesn't match the carrier-domain pattern requiring `/track`. The digit string that looked DHL-shaped is a footer ID fragment, not a tracking number (see correction above). |

---

## Summary tally by failure mode (named sub-patterns, since the task's generic (e) bucket dominates)

| Failure mode | Count | Orders |
|---|---|---|
| Amazon no-box return flow — no tracking number in the email by design | **4** | #3, #4, #6, #11 |
| **CONFIRMED real parser gap — tracking number present as HTML text, invisible to the pipeline** | **2** | #5 (Julia Amory), #7 (NET-A-PORTER) |
| PDF attachment, no other signal | 2 | #1 (Zara), #12 (The RealReal) |
| Generic carrier locator link, no embedded ID | 1 | #2 (Ancient Greek Sandals) |
| Redirect-wrapped link (ESP click-tracking), real destination invisible | 1 | #9 (Gap Inc.) |
| Returns-portal-only link, no visible number | 1 | #10 (Ruti) |
| No return_label email linked, none unlinked | 1 | #8 (SSENSE) |

Mapped to the task's four requested categories: **(a) unsupported carrier: 0** — none of the 12 involved a carrier `parseTracking()` doesn't recognize at all (DHL and UPS were both already supported before the 2026-09-04 carrier-list expansion; that expansion does not resolve any of these 12). **(b) PDF attachment: 2.** **(c) image/QR: 0 as a sole cause** (one Amazon email has a QR image, but it's not the deciding factor — Amazon's flow has no number in the email regardless of the image). **(d) email not linked: 1.** **(e) something else: 9**, broken into the five named sub-patterns above.

---

## Recommendation

The single most tractable, highest-confidence finding is the **HTML-text gap (2 confirmed cases, Julia Amory and NET-A-PORTER)**: a real tracking number, in a format the parser already recognizes (UPS `1Z...`), sits as visible link text in the email — invisible only because `parseTracking()`'s plain-text fallback never receives HTML content, only the separate `textBody` field, which was empty on both these emails. This is a bounded, well-characterized gap, not a data-absence problem — a fix would need no new carrier support, just a way to check HTML-stripped text as a third phase. (Not implemented here — out of scope for this diagnostic — and any such fix would need real care: this diagnostic's own false-positive corrections above show that doing this naively with bare-digit-count carrier patterns, like DHL's, would introduce order-number and footer-ID false positives. A safe version would likely restrict HTML-stripped-text scanning to distinctive-prefix carriers only.)

The largest single bucket by count (4 of 12) is the **Amazon no-box return flow**, and it directly contradicts this diagnostic's opening assumption that "missing tracking almost always means the data existed and we failed to extract it" — for these 4 orders, no tracking number is ever stated in the email at all; Amazon's own web/app flow generates a QR code or print-at-home label behind an authenticated session the app has no path to. This is not an extraction gap and not fixable by improving `parseTracking()` — flagging it plainly rather than folding it into the "we can fix this" narrative.

The remaining 6 orders (locator-link-only, redirect-wrapped, portal-only, PDF-only, unlinked) are each real but individually small (1-2 orders each) and structurally different from one another — no single fix addresses more than 2 of them. Given the small overall population (12 orders), the conservative read is: the HTML-text-gap fix is the only change here with a clear mechanism and a repeatable payoff; everything else is either not fixable via extraction (Amazon) or too thin a sample (1-2 orders per pattern) to justify a dedicated fix on this data alone.

**Bias check:** every count in this report is out of 12 orders total; the largest named bucket is 4. Treat all of these as directional on a small population, not a stable rate — and treat the "PDF"/"portal"/"locator-link" categories as provisional single-example characterizations, not confirmed patterns the way the two HTML-text-gap cases are.

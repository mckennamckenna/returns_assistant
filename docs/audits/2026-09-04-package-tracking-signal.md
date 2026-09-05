# Package-tracking signal audit — coverage & correctness

**Date:** 2026-09-04 (run 2026-09-05). **TASKS.md 🔴 Now item:** "Audit: what tracking are we already surfacing, and is it right?"

**Method:** read-only Prisma queries + the app's own `decrypt()` helper + regex/string matching. **Zero writes. Zero Anthropic/model calls.** Re-runnable: `npx tsx scripts/audits/package-tracking-signal.ts`.

Snapshot: 214 orders, 1,405 emails, run against production data 2026-09-05.

---

## Q1 — Coverage

"Surfaced" = the exact condition the UI already checks to render a tracking link (`OrderCard.tsx` / `orders/[id]/page.tsx`): **both** the tracking number **and** tracking URL fields must be non-null. Carrier is not required by the UI, so it's not required here either.

| Direction | Eligible | Surfaced | Coverage |
|---|---|---|---|
| Incoming (order has ≥1 linked `shipping_confirmation` email) | 149 | 78 | **52.3%** |
| Outbound (`displayStatus` in `return_requested`/`returned`) | 14 | 2 | **14.3%** |

Outbound's denominator is small (14 orders) — treat the 14.3% figure as directional, not a stable rate.

**By retailer** (full breakdown in script output; highlights below — 1-order retailers omitted where 100%/0% isn't meaningful on n=1):

Incoming, retailers with ≥3 eligible orders:
| Retailer | Coverage |
|---|---|
| Amazon | 42/71 (59.2%) |
| Shopbop | 0/4 (0.0%) |
| The RealReal | 0/4 (0.0%) |
| Gap | 0/3 (0.0%) |
| NET-A-PORTER | 0/3 (0.0%) |
| Wayfair | 1/3 (33.3%) |

Outbound (all retailers, n is small everywhere — 1 order each except Amazon):
| Retailer | Coverage |
|---|---|
| Amazon | 0/4 |
| H&M | 1/1 |
| Target | 1/1 |
| Zara, Ancient Greek Sandals, Julia Amory, NET-A-PORTER, SSENSE, Gap Inc., Ruti, The RealReal | 0/1 each |

**Read:** incoming coverage is a coin flip overall (52.3%), and several higher-volume retailers (Shopbop, The RealReal, Gap, NET-A-PORTER) are at **zero** coverage despite multiple eligible orders each — that's a more actionable signal than the aggregate number. Outbound coverage is low (14.3%) but the population is too small (14 orders) to generalize from yet.

---

## Q2 — Correctness of carrier attribution

Checked orders where a carrier is already attributed (`carrier`/`returnCarrier` non-null) against **tighter real-world tracking-number formats**, not the app's own production regexes (`lib/trackingParser.ts`'s DHL pattern is just "10-11 digits" — too loose to be a meaningful correctness check on itself).

| Direction | Carrier attributed | Checkable (carrier pattern known + number present) | Match | Mismatch | Unverifiable (no number) |
|---|---|---|---|---|---|
| Incoming | 80 | 78 | 78 | **0** | 2 |
| Outbound | 8 | 6 | 6 | **0** | 2 |

**Zero format-level mismatches found in either direction.**

### Sanity check against the known H&M case — reported honestly, as instructed

The known H&M order (pre-audit manual finding: labeled DHL, actually a USPS-delivered number) **was tested directly**:

| Order | returnCarrier | returnTrackingNumber | Format-check result |
|---|---|---|---|
| `cmru5viic0009w97c9q00zh0c` | DHL | 68462778273 (11 digits) | **match** — not flagged |
| `cmrus04qy0008l704fk8oww4r` | DHL | 68468087873 (11 digits) | **match** — not flagged |

**This confirms format-regex alone does not catch this class of mislabel.** Both numbers are 11 digits, which satisfies a real-world DHL format cleanly — the actual defect (DHL eCommerce/DHL Global Mail handing last-mile delivery to USPS) is a **business-logic collision, not a format collision**: the number genuinely looks like a DHL tracking number by shape, it's just delivered by a different carrier in practice. No regex on digit count/prefix will distinguish this case from a real DHL number, by construction. Per instruction, the regex was **not** loosened to force a match — the zero-mismatch result stands as reported, with this caveat.

**Practical implication:** the format-regex check is a real but narrow tool — it catches a carrier being attributed a tracking number that doesn't fit *any* plausible shape for that carrier (a distinct failure mode from DHL/USPS handoff-style collisions). Zero results here should be read as "no format-shape errors found," not "no attribution errors exist" — see the Appendix for a second, non-format signal that did catch the known case.

---

## Q3 — PDF-attachment channel + carrier inventory (return_label emails)

Only `return_label` is a return-shipping email type in this schema (confirmed by querying live `emailType` values — no `return_confirmation`/`return_shipping` exist). `refund` also exists as a return-side type but carries no shipment tracking (`applyReturnTracking`'s emailType gate is `return_label`-only), so it's out of scope here.

**Population:** 41 `return_label` emails. **With ≥1 PDF attachment: 4 (9.8%)**.

By retailer (all retailers with a `return_label` email):
| Retailer | With PDF | Total |
|---|---|---|
| Zara | 1 | 1 |
| Mango | 1 | 2 |
| Moda Operandi | 1 | 1 |
| The RealReal | 1 | 1 |
| Amazon, J.Crew, Walmart, Julia Amory, DONNI., Suzie Kondi, Ruti, Shopbop, With Nothing Underneath, NET-A-PORTER, Hill House Home, Bloomingdale's, Target, Ancient Greek Sandals, Chan Luu, H&M, Gap Inc. | 0 | (35 emails across these) |

**Read:** the PDF channel is real but small (4 of 41, concentrated in Zara/Mango/Moda Operandi/The RealReal) — not a dominant pattern across retailers.

### Carrier-mention / URL inventory (for a future carrier-attribution decision — not acted on here)

Full per-email inventory (carrier names found as literal strings in subject/body, all carrier-domain URLs found, PDF filenames) is in the script's stdout output; two findings worth flagging directly:

- **2 of 41 return_label emails literally mention "USPS" in body text and contain a `usps.com` URL, while the email's own retailer (H&M) is elsewhere attributed to carrier DHL on the linked order.** These are exactly the two H&M orders in the known pre-audit finding (see Appendix).
- 1 Mango and 1 Julia Amory return_label email also mention "USPS" with a `tools.usps.com` URL — worth checking if a similar DHL/USPS-style (or other) mislabel exists there; not confirmed, just flagged as a candidate from the inventory.
- Several NET-A-PORTER/Ancient Greek Sandals emails mention "DHL" and link to `locator.dhl.com` (a generic locator page, not a trackable URL with a number) — consistent with the 2 orders seen earlier with `returnTrackingNumber: null` despite `returnCarrier: DHL`.

---

## Q4 — Missing-tracking diagnosis

**Eligibility is asymmetric by the definitions given for Q1, and that asymmetry is reported directly rather than forced into a symmetric table:**
- Incoming eligibility *requires* a linked `shipping_confirmation` email to exist.
- Outbound eligibility is `displayStatus`-based and requires no email at all.

This means bucket (a) "no relevant email received at all" is **structurally impossible for incoming** — every incoming-eligible order has a linked shipping email by construction. It's a property of the two different eligibility definitions in the brief, not a bug in the check.

### Incoming (71 orders missing tracking)
| Bucket | Count | % |
|---|---|---|
| (c) email present, extraction ran, no tracking pulled | 71 | 100% (by construction) |
| (a) no relevant email | 0 | — (impossible under this eligibility definition) |
| (b) email present but blocked upstream | 0 | — (impossible — eligibility requires a *linked* email) |

**All 71 incoming misses are extraction/parsing misses on an already-linked, already-typed email** — `lib/trackingParser.ts`'s `parseTracking()` ran against the email body and found nothing it recognized. This is the single most concrete, actionable number in this report.

### Outbound (12 orders missing tracking)
| Bucket | Count | % |
|---|---|---|
| (a) no relevant email received at all | 1 | 8.3% |
| (b) email present but blocked upstream (heuristic: an unlinked `return_label` email exists for the same user + exact retailer string) | 0 | 0.0% |
| (c) email present (linked), extraction ran, no tracking pulled | 11 | 91.7% |

Bucket (b) is a best-effort heuristic (same `userId` + exact retailer-string equality against an unlinked `return_label` email) — DB-field equality only, no fuzzy or model-based matching, so it's a lower bound, not a guarantee.

### Supplementary context (email-level, not folded into the order-level buckets above)
- `shipping_confirmation` emails: 213 total, **18 never linked to any order**.
- `return_label` emails: 41 total, **1 never linked to any order**.

These 18 + 1 unlinked emails sit outside the Q1-eligible order population entirely (by definition — they never became part of an Order), so they're not "missing tracking on an eligible order," but they are real signal sitting in Needs Review that never got a chance to surface anything.

---

## Appendix — DHL/USPS mislabel population size

**Not being fixed this session, per owner.** Surfacing population size only, using the Q3 body-text/URL inventory rather than the Q2 format-regex (which Q2 confirmed does not catch this class of collision).

- Outbound orders labeled `returnCarrier: DHL`: **5**
- Of those, orders whose linked `return_label` email *also* mentions "USPS" in body text or contains a `usps.com` URL: **2** — both H&M, both matching the pre-audit finding exactly (`cmru5viic0009w97c9q00zh0c`, `cmrus04qy0008l704fk8oww4r`).

This is a real, non-format signal (not exhaustive — it only checks `return_label` emails that are actually linked to an order, and only for a literal "USPS" mention or a `usps.com` link) — a defensible **lower bound of 2 confirmed, out of 5 DHL-labeled outbound orders**, for future triage.

---

## Recommendation

The biggest gap is **extraction/parsing on incoming, not coverage on outbound and not carrier-attribution correctness**. All 71 incoming misses are already-linked, already-typed `shipping_confirmation` emails where `parseTracking()` simply found nothing — that's a fixable parsing problem on a well-defined, already-isolated population, not an ingestion or linking problem. Outbound's low coverage (14.3%) is real but the sample is too small (14 orders, 12 missing) to prioritize over the 71-order incoming gap. Carrier-attribution correctness looks clean on a format-regex basis (0 mismatches), but that's a narrow tool — the one confirmed real-world mislabel (H&M DHL/USPS) is invisible to format checks by nature and was only surfaced via a separate body-text signal, so "0 format mismatches" should not be read as "attribution is correct." A minimal next step: pull the 71 incoming `shipping_confirmation` bodies that produced no tracking match and look for a common shape `parseTracking()` isn't handling (new carrier, different HTML structure, etc.) — that is where the volume actually is.

**Bias check:** the outbound coverage number (14.3%) and every outbound retailer breakdown are on n≤14, several retailers at n=1 — reported as directional, not stable, per the conservative-bias instruction.

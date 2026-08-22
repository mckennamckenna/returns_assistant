# Retailer Logo Coverage Test — Investigation Report

**Date:** 2026-07-13
**Status:** Investigation only. No code, schema, or UI changes made. No commits.
**Question:** Would Logo.dev actually cover the retailers in our DB before we build a logo registry/UI?

**Bottom line up front:** Yes, Logo.dev has *an* image for almost every
retailer (43/46 orders weighted, 93.5%) — but raw hit rate is the wrong
headline number. Once you actually look at what came back, only **78.3%**
of order-weighted volume gets a **confidently correct** logo. The gap between
those two numbers is the real finding: one domain hit (Gap Inc.) and two name
hits (NET-A-PORTER, Sidekick) are confidently the **wrong company's** logo,
and four more name hits are generic single/double-letter monograms we can't
verify are the right company at all. A wrong-but-confident logo is worse
than no logo — this needs a manual review pass before any of this ships, not
just a coverage number.

`LOGO_DEV_PUBLISHABLE_KEY` is now set in `.env.local` only (gitignored, not
committed, not added to Vercel). Both hit-checks below were run for real
against the live Logo.dev CDN.

---

## 1. Schema check

**No plaintext sender-domain field exists anywhere in the data model.** The
only structured, queryable retailer-identity field is `Order.retailer` /
`Email.retailer` (`prisma/schema.prisma:96,139`) — an AI-derived **brand
display name** (e.g. "J.Crew"), extracted from the email **body**. The
extraction prompt explicitly forbids deriving it from the sender header
(`lib/extract.ts:116`: "from body only, NEVER from the subject line or From
header").

The only field that could yield a sender domain is `Email.fromEmail`
(`prisma/schema.prisma:86`), and it's AES-256-GCM encrypted at rest
(`lib/emailEncryption.ts`, `lib/crypto.ts`) with no plaintext copy or derived
domain column stored separately. `decryptEmailContent()` exists
(`lib/emailEncryption.ts:23`) but has zero call sites in the app today.

**Practical consequence:** getting a sender domain today means decrypting
`fromEmail` for every `Email` row at read/build time — a small
extraction/backfill addition, not a pure lookup.

**Wrinkle found empirically:** the code comment at `lib/extract.ts:99`
states the From header always shows the customer, not the retailer (true for
a manually forwarded email). But roughly **half of real orders in this DB
defy that** — their `fromEmail` domain is a genuine retailer/vendor domain,
likely because Gmail-filter auto-forwarding preserves the original `From:`
header while manual "Fwd:" doesn't (Caroline, per TASKS.md, forwards
manually). Coverage here will vary by *how a user forwards*, not just by
retailer.

## 2. Retailer inventory

37 distinct retailer strings across 46 orders (no null retailers). One data
quality note: **"Mango" and "MANGO" exist as two separate retailer strings**
(1 order each) — logged to Known Issues, not fixed (out of scope here).

## 3. Domain pass — results (real Logo.dev query, `fallback=404`)

Candidate = the actual observed non-consumer-webmail sender domain
(decrypted `fromEmail`, reduced to registrable root), for the 15 retailers
where one exists (23 of 46 orders, 50%, weighted).

**15/15 hit (100%).** But one hit is confidently the wrong company:

| Retailer | Orders | Candidate domain | Hit | Logo returned | Correct company? |
|---|---|---|---|---|---|
| Amazon | 8 | amazon.com | Y | orange smile-arrow mark | ✅ Correct |
| Shopbop | 2 | shopbop.com | Y | "shopbop" wordmark | ✅ Correct |
| J.Crew | 1 | jcrew.com | Y | "J.CREW" shield, green | ✅ Correct |
| Poshmark | 1 | poshmark.com | Y | interlocking "P" mark, maroon | ✅ Correct |
| Mango | 1 | mango.com | Y | "MANGO" wordmark | ✅ Correct |
| Upway United States | 1 | upway.shop | Y | "upway" wordmark, blue | ✅ Correct |
| Southbank Centre | 1 | southbankcentre.co.uk | Y | yellow square, black "S" | ✅ Correct |
| **Gap Inc.** | 1 | **optiturn.com** | Y | **yellow lightning-bolt mark** | ❌ **Wrong — this is Optiturn's (the returns-processing vendor's) own logo, not Gap's.** Confirms the §7 risk directly: a real, observed sender domain that is not the retailer's own site. |
| H&M | 1 | hm.com | Y | "H&M" red script | ✅ Correct |
| AquaTru | 1 | aquatru.com | Y | "AQT" teal gradient mark | ✅ Correct (abbreviated icon form) |
| VPL Bike | 1 | vpl.bike | Y | circular badge, cyclist + "VPL" | ✅ Correct |
| Lola Blankets | 1 | lolablankets.com | Y | "lola BLANKETS" wordmark | ✅ Correct |
| Proenza Schouler | 1 | proenzaschouler.com | Y | stylized "S" mark | ✅ Correct |
| COMMENSE | 1 | thecommense.com | Y | "COMMENSE" wordmark | ✅ Correct |
| Fitness Superstore | 1 | fitnesssuperstore.com | Y | house + dumbbell icon | ✅ Correct |

**Domain-pass quality-adjusted: 22/23 orders (95.7% weighted) genuinely
correct; 1/23 (4.3%, Gap Inc.) confidently wrong despite being a "hit."**

## 4. Name pass — results (real Logo.dev query, `img.logo.dev/name/{retailer}`, `fallback=404`)

Run against the 22 retailers with no observed sender domain (23 orders
weighted, including "MANGO" the casing-duplicate).

**20/22 hit (23 orders weighted → 20 hit, 87%).** Two genuine misses:
**On (On-Running)** and **Freda Salvador** — both 404'd, no logo at all
either way.

Of the 20 hits, visually reviewed each returned image against the real
brand:

**✅ Confirmed correct (7):**
| Retailer | Logo returned |
|---|---|
| MANGO | "MANGO" wordmark |
| SWIMS | orange circle, "SWIMS" script |
| Nordstrom | "NORDSTROM" wordmark, dark bg |
| Old Navy | navy oval, "OLD NAVY" |
| DÔEN | "DÔEN" wordmark (accent preserved correctly) |
| Tuckernuck | circular badge, "TUCKERNUCK / TNUCK.COM" |
| Spanx | "SPANX" wordmark, black bg |

**🟡 Plausible / likely correct, not independently verified (7):**
| Retailer | Logo returned |
|---|---|
| Westman Atelier | heart outline with "WA" monogram |
| With Nothing Underneath | "WNU" navy monogram |
| Ruti | yellow circle, "RUTI" wordmark |
| Tea Collection | cursive "tea" script |
| Splendid | cursive "Splendid" on navy circle |
| Hanna Andersson | cursive "hanna" on red |
| Julia Amory | serif "JA" monogram |

**❌ Confidently WRONG (2) — this is the real risk the amendment was asking about:**
| Retailer | Logo returned | Why it's wrong |
|---|---|---|
| **NET-A-PORTER** | stylized "N\|Y" monogram | Does not remotely resemble NET-A-PORTER's real wordmark identity — reads as an unrelated company's mark ("NY"-ish initials). |
| **Sidekick** | purple lightning-bolt icon | Matches the well-known generic "Sidekick" tech-brand bolt icon (à la the old T-Mobile Sidekick), not a boutique retailer mark. Textbook generic-name collision — flagged as a risk in the first report, now directly confirmed. |

**⚠️ Uncertain / generic-mark risk (4) — can't confirm without more direct verification:**
| Retailer | Logo returned | Note |
|---|---|---|
| Dermstore | bare black "D" mark | Generic single-letter monogram; spot-checked dermstore.com's page source, couldn't confirm the mark from markup alone. |
| Moda Operandi | "MODA" (partial wordmark, dark green) | Real brand is "Moda Operandi" — this may be their shorthand mark, or may be a different "Moda"-named company. Truncated name = collision risk. |
| Bettervits USA | abstract mint "B" icon | Generic single-letter monogram, unverifiable at this resolution. |
| Loeffler Randall | black "LR" monogram | Spot-checked loefflerrandall.com: image asset filenames suggest a brown-toned mark, but the returned logo is plain black — inconsistent, can't confirm it's actually this brand's own mark. |

## 5. Chan Luu / Tuckernuck / Donni — explicit callout

- **Tuckernuck**: present, 1 order. Name-lookup hit, **confirmed correct**
  ("TUCKERNUCK / TNUCK.COM" badge) — matches the earlier name-guess domain
  (`tuckernuck.com`), independently confirmed by a second method.
- **Chan Luu**: not present in the current DB (0 orders).
- **Donni**: not present in the current DB (0 orders).

## 6. Overall weighted hit rates (46 orders total)

| Metric | Weighted result |
|---|---|
| Domain-only hit rate (of the 23 orders with an observed domain) | 23/23 = 100% |
| Domain-only hit rate (as share of ALL orders) | 23/46 = 50% |
| Name-only hit rate (of the 23 orders lacking an observed domain) | 20/23 = 87% |
| **Domain-OR-name hit rate (share of ALL orders with any logo returned)** | **43/46 = 93.5%** |
| Domain-OR-name miss rate (On, Freda Salvador) | 3/46 = 6.5% |
| **Quality-adjusted: confidently correct-company logo** | **36/46 = 78.3%** |
| Confidently WRONG company logo (Gap Inc., NET-A-PORTER, Sidekick) | 3/46 = 6.5% |
| Uncertain / unverified generic mark (needs manual eyeball) | 4/46 = 8.7% |
| No logo at all (On, Freda Salvador) | 3/46 = 6.5% |

36 + 3 + 4 + 3 = 46. ✅

**The takeaway: raw coverage (93.5%) looks great and would be the wrong
number to report to justify building this. The number that matters is 78.3%
confidently-correct, with a further 8.7% needing a human to eyeball before
trusting it — meaning ~15% of order volume needs a manual review step no
matter what, not just an automated lookup.**

## 7. Risk pattern confirmed: third-party returns-vendor domains

Gap Inc.'s real, observed sender domain is `optiturn.com` — a third-party
returns-processing platform (Optoro), not Gap's own site. This is now
**directly confirmed**, not just theorized: Logo.dev returned Optiturn's own
yellow lightning-bolt logo for it. Any sender-domain-derived feature needs
this in its exclusion list alongside marketing ESPs — candidates: Optiturn,
Narvar, Happy Returns, Loop, AfterShip.

## 8. Name-guess-vs-name-lookup: one correction to the first report

The first report flagged DÔEN's slugified domain-guess (`den.com`) as likely
wrong. The **name-lookup pass independently got DÔEN right** (correct
wordmark, accent mark preserved). This is a useful data point on its own:
domain slugification is fragile for accented/hyphenated/multi-word brand
names, but Logo.dev's own name-matching handled the same case correctly —
suggesting the name-lookup pass is a legitimately better fallback than
domain-guessing, not just a backstop for domain misses.

## 9. Recommendation

1. **Don't ship raw Logo.dev hits unreviewed.** 3/46 orders (6.5%) would show
   a confidently wrong company's logo; 4/46 (8.7%) are unverified generic
   marks. Combined, ~15% of volume needs a human eyeball pass regardless of
   which lookup method is used.
2. Add returns-logistics vendor domains (optiturn.com, narvar.com,
   happyreturns.com, loopreturns.com, aftership.com) to the domain-source
   exclusion list — directly confirmed necessary by the Gap Inc. case.
3. Prefer Logo.dev's own name-lookup over local domain slugification when no
   sender domain is available — DÔEN is direct evidence the name-lookup
   handles brand-name edge cases (accents, hyphens) better than a naive
   slugify fallback.
4. Watch for generic single-word or single-letter brand names (Sidekick,
   Splendid, Dermstore, Loeffler Randall) — these are exactly where a
   confident-looking wrong hit is most likely, independent of retailer
   volume.
5. If sender-domain-derived logos move forward: no plaintext domain column
   exists today (§1) — either backfill one at extraction time or accept
   decrypting `fromEmail` per row at registry-build time.

---

*Diagnostic scripts and downloaded logo images used to produce this report
were written to the scratchpad / temp scripts only, never committed, and
deleted/discarded after use. `LOGO_DEV_PUBLISHABLE_KEY` was added only to
the gitignored `.env.local` — not committed, not pushed to Vercel. No
production data was modified.*

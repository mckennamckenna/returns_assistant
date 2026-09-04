# Domain-audit — retailer-domain coverage across active, reminder-eligible orders — 2026-09-02

Read-only, 0 Anthropic API calls. Scope: every order the daily deadline-reminder
cron actually processes — `reminderOrderWhere()` (`lib/orderFilters.ts`:
`archivedAt: null, deletedAt: null`) minus `isAmazonOrder()` (`lib/amazonBundle.ts`,
skipped inside the cron loop at `app/api/cron/route.ts:268` — Amazon orders get
awareness-only via the digest, never a standalone reminder, so `returnPortalUrl`
coverage on them is moot). This is the same scope the original fleet audit used.

**Total in scope: 44 active, non-Amazon, reminder-eligible orders** (up from
36 at the original 2026-09-01 audit — 8 new orders since, all still awaiting
their first web-lookup pass; see `traces.md`'s methodology note).

## Coverage breakdown

| Bucket | Count |
|---|---|
| Has its own `returnPortalUrl` (any quality — good or bad, per `categories.md`) | 36 |
| No own URL, but a same-retailer `returnPortalUrl` exists on another order | 0 |
| No own URL, no same-retailer fallback, but a usable email `From:` domain exists | 8 |
| No signal at all (no URL, no fallback, no email domain) | 0 |

**Every one of the 44 active non-Amazon orders has at least one usable
retailer-domain reference today** — either its own stored `returnPortalUrl`
(36) or, failing that, the sender domain off the order's own linked
`Email.fromEmail` (8, the orders still awaiting a first web lookup). Nothing
in the current active set is a dead end where no domain reference could be
constructed at all.

**Zero same-retailer-fallback opportunities exist in the current gap.** The
8 URL-less orders are each a genuinely one-off retailer this session (Credo
Beauty, VPL Bike, Rowing Pad, Chewy, Goldbelly, Buff Beauty, nmjlmajong,
Charmspring) — none share a retailer with any other order in the active set,
active or archived, that already has a `returnPortalUrl` on file. This
matches the original audit's coverage-gap investigation
(`TASKS.md`, "coverage gap investigated, no build warranted" — 8 orders,
8 different one-off retailers, no concentration) — a same-retailer fallback
mechanism (the kind that would trivially fix Gap/Target-shaped gaps) would
help zero of these 8 today, though it remains a real defense for the *next*
time a retailer with an existing good URL on file gets a second order before
its own lookup completes.

## What the email-domain fallback actually looks like

Of the 8 URL-less orders, **7 have an email `From:` domain that is directly
the retailer's own registrable domain** — `credobeauty.com`, `vpl.bike`,
`rowingpad.com`, `chewy.com`, `goldbelly.com`, `nmjlmajong.com`,
`charmspring.com`. A same-domain construction (e.g. `https://{domain}/`
as a homepage-level last resort, or `https://{domain}/returns` as a guess)
would be directly derivable for these 7 with no new curation.

**1 of the 8 (Buff Beauty, order `BB002415`) does not** — its only linked
email's `From:` domain is `t.shopifyemail.com`, a Shopify-managed
email-sending subdomain, not the retailer's own domain. Deriving a usable
retailer domain for this one would require either the retailer name itself
("Buff Beauty" → `buffbeauty.com`, a plausible but unverified guess) or a
second linked email from a domain that does carry the retailer's own name —
neither is a mechanical derivation the way the other 7 are.

## Data sources a future fallback mechanism could rely on

1. **`Order.returnPortalUrl` on this exact order** — the primary source
   today; covers 36/44 (though `categories.md` shows a meaningful share of
   those 36 are themselves wrong).
2. **`Order.returnPortalUrl` on any other order for the same normalized
   retailer name** — a real, cheap fallback (this is exactly what the
   original audit meant by "Gap and Target both already have a good URL on
   file from another order for the same retailer... could self-heal both
   with zero new curation") but contributes 0/44 in the *current* gap
   specifically because the current gap is all one-off retailers. Still
   worth building as a standing safety net for future orders, just not a
   fix for today's 8.
3. **`Email.fromEmail`'s domain, decrypted** (`lib/crypto.ts`'s `decrypt()`)
   — no dedicated schema field stores this; it has to be derived at query
   time from an already-linked Email row. Covers 7/8 of the remaining gap
   directly (retailer's own domain), 1/8 only if a second, better-sourced
   email later links to the same order.
4. **`registrableDomain()` (`lib/extract.ts:439`) already exists** as the
   eTLD+1 extraction utility used by `classifyReturnPortalTrust` — the same
   function that would need to run over the `fromEmail` domain (or an
   existing `returnPortalUrl`'s hostname) to turn either of the two sources
   above into a clean, comparable domain value. No new domain-parsing logic
   would be needed; it's already been vetted (multi-label TLD handling, no
   public-suffix-list dependency) for exactly this kind of use.
5. **No dedicated "retailer domain" field exists on `Order` or `Email`
   today.** `Order.retailer` and `Email.retailer` are free-text strings
   (`prisma/schema.prisma`, `Order` model line 233, `Email` model line 119),
   not domains — any fallback mechanism has to derive a domain at read time
   from one of sources 1–3 above, or a new field would need to be added to
   cache the derived value (an additive, nullable column — in-bounds per
   this repo's migration rules, but a build decision, not made here).

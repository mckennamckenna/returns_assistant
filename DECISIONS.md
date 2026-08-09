# DECISIONS.md — Return Window

Dated decision log. Migrated from inline STANDING CORRECTION / SUPERSEDED /
ACCEPTED ASSUMPTION / Close-out decision notes that had accumulated inside
`TASKS.md`'s 🔴 Now section. Newest first. `TASKS.md` retains a one-line
`→ see DECISIONS.md YYYY-MM-DD` pointer at each note's original location.

---

## 2026-08-09 — WATCH-ITEM: Amazon-default deadlines anchor on order-date, deliberately early

Not a bug — a recorded trade-off, noted for future reference, no action taken.

The `amazon_default` path (`lib/extract.ts`, see 2026-08-08 below) never sets
`returnWindowStartsFrom`, so every windowless Amazon order it touches lands in
`computeDeadline()`'s branch 2 (`orderDate + returnWindowDays`, `deadlineIsEstimated:
true`) rather than the delivery-anchored branches — confirmed by walking the function's
actual branch order and verified against the one backfilled row (`cms0p1qi0...`: orderDate
2026-07-25 → deadline 2026-08-24, exactly orderDate + 30, `deliveredAt`/
`estimatedDeliveryDate` both null throughout). The `STANDARD_SHIPPING_DAYS` 5-day buffer
(branch 5) is never reached by this path.

Consequence: Amazon return-window reminders computed this way will tend to land a few
days earlier than the true delivery-anchored deadline would produce, since order-date
always precedes delivery-date. Accepted as-is because it's conservative in the safe
direction (an early reminder, never a missed one) — the same reasoning already governing
`computeDeadline()`'s 2026-07-15 case-1b decision. If this ever needs tightening, the fix
lever is routing `amazon_default` through a delivery estimate (e.g. carrier ETA or
`deliveredAt`) instead of order-date — not attempted here.

---

## 2026-08-08 — Amazon return-window default: 30 days, marketplace sellers included

Owner decision: any `isAmazonOrder()` match with no stated return window defaults to
`returnWindowDays: 30` and skips `lookupReturnPolicy()` entirely (branch:
`amazon-return-window-default`, not yet merged). Scope is every `isAmazonOrder()` match,
**including third-party marketplace sellers fulfilled through Amazon** — their return
policy can differ from Amazon's own 30-day standard, but that imprecision is an accepted
v1 simplification, not scoped out. Revisit if/when an "asterisk" pass on per-seller policy
accuracy happens; not tracked as an open bug until then.

Step 0 census (this task) found the volume justifying this: 94 of 99 Amazon-retailer
emails ever received (95%) already carry `policySource: "web_lookup"`, i.e. already
triggered a billed Sonnet+web-search call historically that deterministically resolves to
~30 days. Guard confirmed necessary: of the 4 Amazon orders flagged `needsReview: true`,
only 1 has a genuinely missing window — the other 3 already have `returnWindowDays: 30`
via `web_lookup` and are flagged for an unrelated tier/category-confidence reason, left
untouched by this rule.

Grocery (Whole Foods / Amazon Fresh) is explicitly **not** part of this decision — it
keys off retailer name rather than `isAmazonOrder()` and is its own separate, not-yet-
started task (see `TASKS.md` 🔴 Now).

---

## 2026-07-29 — CARD_SPEC Part 5 signed off; card-geometry build unblocked

All 9 open decisions in `CARD_SPEC.md` Part 5 answered by the owner, recorded in
`CARD_SPEC_Part5_signoff.md` (that file wins over `CARD_SPEC.md`'s own inline draft
text where they differ — its blanks were intentionally left unfilled in favor of the
separate sign-off doc). Build brief for Claude Code: `CC_BUILD_PROMPT_card_geometry.md`.

The 9, condensed (full reasoning in the sign-off doc):
1. Bucket name → **"Needs review"** everywhere, including the summary-stat pill
   (currently "Need attention" in the mockup — carry-in fix).
2. Overflow threshold → reuse the Amazon bundle's inline limit; read the literal from
   `lib/amazonBundle.ts`, don't re-decide it.
3. Keep is available pre-delivery ("Awaiting delivery" state), archives immediately.
4. Slot-4 action copy approved as written (`Keep` / `Start Return` / `Dropped it off?` /
   `Refund received?`) — carry-in: reconcile vs. the detail page's `Keeping it`.
5. Slot-3 chip copy approved as written.
6. "View detail" = expand in place first (progressive disclosure), not a page nav.
7. Overflow menu (mobile #3) → no `⋯`, no glyph, no swipe/gesture on the collapsed row;
   `Archive`/`Delete` become labeled text controls inside the expanded state (own
   confirm on Delete, junk-with-rescue, never hard delete).
8. Kept/Complete auto-archive immediately, no warning; unarchive is also single-step,
   no warning — valid only because slots 3-4 are a pure function of order state, so an
   unarchived Kept/Refunded order must render its terminal chip, never a recomputed
   countdown (this is the already-logged "unarchive re-surfaces a countdown" bug; the
   build must include a regression test for it).
9. Needs-review action set (Link to order / Not a purchase / View detail / Nothing) is
   a **v1 open registry**, not closed — room to add actions later; unknown reason
   degrades to View detail, never throws.

**Verification note, for the record:** at the start of this same close-out session, an
initial check found neither `CARD_SPEC_Part5_signoff.md` nor
`CC_BUILD_PROMPT_card_geometry.md` present in the repo, and `CARD_SPEC.md`'s own Part 5
blanks unfilled — flagged as a discrepancy rather than assumed. Both files appeared
(file timestamps ~20:43, mid-session) shortly after, most likely the owner completing
them in another window while this session was already in progress. Re-checked and
verified against their actual content before writing this entry — not taken on faith
from either the earlier-absent state or the later brief.

---

## 2026-07-26 — Confirmed: one database, not separate dev/prod

`.env`'s `DATABASE_URL` and Vercel Production's are the same Neon
database (`ep-small-paper-ad44j3vk`), not a dev copy with a separate
production database behind it. A prior note in `TASKS.md`'s Known Issues
(2026-07-20) had assumed this ("likely, given this project's established
pattern") but explicitly flagged itself as unconfirmed — that hedge was
correct to have at the time and should not have been treated as settled
fact in this session before re-verifying it directly.

Verified today two ways: (1) two attempts to read Vercel Production's
`DATABASE_URL` value directly via `vercel env pull` both returned empty
— consistent with it being a Vercel "Sensitive" env var, unreadable via
the CLI once set, not proof either way on its own; (2) checked
production's actual runtime logs instead — real inbound webhook requests
processed successfully (200, zero error-level logs in the preceding 6
hours) by the already-deployed code that writes `Email.forwardType`/
`anchorDate`/`anchorSource`, columns that only exist on the database at
`.env`'s `DATABASE_URL`. If production ran against a different database
lacking those columns, every one of those real requests would have
thrown a Prisma error. None did.

**Practical consequence, going forward:** every `prisma migrate dev` or
`migrate deploy` run locally is a live production schema change the
moment it applies. There is no separate dev database absorbing risk —
treat every migration with that weight before running it. See
`CLAUDE.md`'s Stack & infra section for the standing note.

---

## 2026-07-25 — ANCHOR_DATE_RESOLVER.md Part 4: owner answers

1. **Providers:** Gmail only for now. Default everything non-Gmail to
   manual. Don't block on researching other providers — add them later
   when a non-Gmail user actually appears.
2. **Quoted-date parse scope:** Gmail's `Date:` format only at launch.
   Anything that doesn't parse falls to the low-confidence / unresolved
   path.
3. **Unresolved-manual:** yes — route to the needs-review bucket with a
   plain reason, never silently estimate. Owner wants these surfaced.
4. **Onboarding push:** out of scope, ignored for this build.
5. **`anchorSource`:** keep the debug enum long-term.

Build order: Part 2 (the resolver) first, then Part 3 (the sanity guard)
as a same-session follow-on if clean. See `TASKS.md` 🔴 Now for the build
item this unblocked.

---

## 2026-07-23 — STANDING CORRECTION: Needs Review panel registry superseded

**STANDING CORRECTION (2026-07-23, on data):** the Needs Review panel's
per-flag-type registry (`not_ecommerce` → Delete, `duplicate` → Merge) is
SUPERSEDED — flagged in place below and in the Decisions log, not
revised. `not_ecommerce` → Delete is rejected outright (15 of 206 orphans
are real purchases, `emailType` is recomputed not stable,
`prisma.email.delete()` is irreversible — junk-with-rescue replaced it).
Neither `duplicate` nor `not_ecommerce` are real stored flag types at
all — real data is 13 order-level reasons + 206 email-level (the
four-slot panel build, below). The panel gets rebuilt from that inventory, not patched.

---

## 2026-07-23 — SUPERSEDED: not_ecommerce/duplicate aren't real stored flag types

*(Near-duplicate of the entry directly above — same correction, restated in fuller
form inside the Needs Review panel item itself. Preserved verbatim rather than
merged; flagged as redundant in the reorg summary.)*

**SUPERSEDED 2026-07-23, on data — flag, do not build:** this
registry's premise is falsified on two counts. (1) `not_ecommerce` →
Delete was rejected: `emailType` is recomputed (not stable),
`prisma.email.delete()` is irreversible, and 15 of 206 orphans turned
out to be real purchases — junk-with-rescue (`Email.junkedAt`,
`rescueEmail()`, directly below) replaced hard-delete for this
population entirely. (2) There are no stored `duplicate` /
`not_ecommerce` flag types at all — the verify gate proved real data
is 13 order-level reasons + 206 email-level, not these two. Any panel
spec written against this registry does not get revised — it gets
rebuilt from the four-slot panel build (below) instead.

---

## 2026-07-21 — Preorder ship-date handling: accepted assumption

**ACCEPTED ASSUMPTION (per owner, log this — see Decisions log too):**
a preorder is handled as a known-later estimate, not a new concept —
relies on the retailer eventually sending a shipping-confirmation
email that moves the anchor to reality. **Watch-item:** if a retailer
never sends one (or sends one that doesn't restate its own delivery
estimate), that order's deadline keeps the original ship-by estimate
and may drift from the true delivery date. Not a bug — an accepted,
logged trade-off.

---

## 2026-07-21 — Close-out decisions: carrier-link resolve probe

**Close-out decisions, 2026-07-21:**
**Carrier-link resolve: RULED OUT for now**, not just "not viable
today" — reason preserved so it isn't re-litigated from scratch later:
0/6 resolved via plain fetch, for three structurally different
reasons (single-use/expired click-tracker tokens on two targets,
confirmed genuine JS-render-required on one, an auth/login wall on
one that a headless browser wouldn't even fix). The raw-tracking-
-number-in-body alternative (mentioned in the original ask, e.g.
AquaTru's own USPS number) is **parked in 🟡 Next as a later
initiative, explicitly not near-term** — it would mean a real paid
multi-carrier tracking API integration plus a privacy decision
(sending a user's raw tracking number to a third-party API), both
outside this probe's scope and not something to back into via a
quick follow-up.
**Auto-forward dating: GREENLIT, pending the classifier build below.**
24/34 header-verdict auto with under-3-minute forward lag — safe to
treat forward date ≈ send date once the classifier is real and
stored, not just inferred per-investigation. The 10-email manual
bucket (1–165 hour delta) stays explicitly excluded from any
forward-date estimation — too unpredictable to trust.

---

## 2026-07-21 — Forward auto/manual classifier: two design rules

**Two design rules decided at 2026-07-21 close-out, record before
build starts:**
**(1) Handle multiple providers' auto-forward markers, not just
Gmail's `+caf_=`.** This probe only verified Gmail (the only provider
in today's real data) — Outlook/Yahoo/other providers' auto-forward
features use different header signatures entirely. The real
classifier must not hardcode Gmail's marker as the only auto signal;
needs its own small research pass per provider before build, not
assumed to generalize from this probe.
**(2) Default unknown → manual.** If no provider's auto-forward
signature matches (a provider we haven't researched yet, or headers
genuinely absent/malformed), classify as manual rather than auto —
manual is the safe/conservative default since it excludes the order
from forward-date estimation rather than risking a wrong estimate
from an unverified auto-forward assumption.
---

## 2026-07-25 — AMAZON_HANDLING.md v1 approved; O7 resolved

`AMAZON_HANDLING.md` v1 (awareness-only) is approved by the owner. O7 (which
field drives each Amazon row's status label) is resolved in code, not just in
the doc: "delivered" is `deliveredAt !== null` (not `displayStatus`), with
`return_requested`/`returned` always taking priority over a stale
delivered/countdown reading — this is what the built Amazon dashboard folder
card (`lib/amazonBundle.ts`) already implements and what this session's
verification confirmed. No further O7 decision is owed before future Amazon
card work.

---

## 2026-07-25 — Mobile audit finding #3: "..." overflow menu replacement decided

Replace the "⋯" overflow-menu button on `app/OrderActionsMenu.tsx` with an
explicit trash-can icon carrying its own confirm step (matching
`handleDelete`'s existing `window.confirm`), with Archive surfaced as its own
always-visible action rather than tucked behind the same ambiguous glyph.
Decided rather than left as an open proposal, per owner 2026-07-25. Folded
into the "Unified card geometry + order state machine" build item as resolved
groundwork, not tracked as a separate open question.

---

## 2026-08-06 — Gmail deep-link URL construction bug: killed, too unstable

Owner decision: not being fixed. Removed from `TASKS.md`'s Bugs board
(`gmail-deeplink-cross-account-parsing`); the Settings button it would have
gated stays removed permanently, not pending a fix.

Context preserved: 2/2 non-owner test users (mom, then brother) who set up
the Gmail filter via the deep-link ended up with a filter matching their
entire inbox instead of the intended commerce search, feeding their personal
email into Return Window's extraction pipeline. The URL was byte-identical to
the owner's own working one, so this wasn't a "user followed instructions
wrong" case, and debugging it required instrumenting a real browser session
that was never available — high cost, no further diagnostic path without it.
Same over-broad-filter mechanism as the Wayfair leg of the 2026-07-28
cross-user exposure finding (see `HISTORY.md` 2026-07-28), parked separately
in `TASKS.md`'s Watching section the same day as this decision.

OAuth remains the suspected real fix, per the 2026-07-21 carrier-link-resolve
probe close-out — tracked as its own future initiative, not a revival of this
mechanism.

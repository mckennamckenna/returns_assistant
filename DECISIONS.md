# DECISIONS.md — Return Window

Dated decision log. Migrated from inline STANDING CORRECTION / SUPERSEDED /
ACCEPTED ASSUMPTION / Close-out decision notes that had accumulated inside
`TASKS.md`'s 🔴 Now section. Newest first. `TASKS.md` retains a one-line
`→ see DECISIONS.md YYYY-MM-DD` pointer at each note's original location.

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

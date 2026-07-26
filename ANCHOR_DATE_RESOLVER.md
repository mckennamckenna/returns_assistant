# Spec — trustworthy anchor date resolver

Status: DRAFT for owner sign-off. Written 2026-07-25.
Closes three currently-separate items at once:
- `returnDeadline < orderDate` sweep (impossible deadlines)
- Emme Parsons / dateless-email invented-year deadlines
- "Forwarded by you" mislabel + forward auto/manual mis-classification

---

## The one idea

Every email in this product arrives by forwarding. Some dates in an email are
trustworthy; some are invented or mis-anchored. Today the extractor will fabricate a
delivery date when none exists (Emme Parsons → wrong year → deadline before the order
date), and the app assumes every forward is manual regardless of how it actually
arrived. Both are the same missing concept: **a single, trustworthy anchor date per
email, established at ingestion, that downstream deadline math can rely on.**

Establish that anchor once. Never invent a date; a missing date becomes a flag, not a
fabrication.

---

## How to run this on a "push it forward" day

1. Answer Part 4 (Open decisions) — ~10 min, the only creative ask.
2. Hand Part 2 (the resolver) to Claude Code as the build brief.
3. Part 3 (the guard) is a small, independent follow-on — can go same session or later.

---

## Part 1 — Why the two cases are one

| | Auto-forward | Manual forward |
|---|---|---|
| How many dates | One: `receivedAt` ≈ real send (probe: <3 min lag) | Two: outer forward date + original date quoted in body |
| Original `Date` header | Preserved intact in raw headers | Replaced by forward time; original is in the quoted block |
| Trustworthy anchor | `receivedAt` (or preserved original `Date`) | Parse the quoted `Date:` line; NOT `receivedAt` |
| Detect it by | `+caf_=` return-path marker, `X-Forwarded-For`/`-To` (Gmail); other providers vary | Absence of auto markers (default) |

Worked example (real, Tuckernuck, 2026-07-25): manual forward. Postmark
`receivedAt` = Jul 16 5:50 PM. Quoted body header = `Date: Mon, Jul 13, 2026 at
4:39 PM`. A 3-day gap — using `receivedAt` as the anchor would push the deadline 3
days late. The right anchor (Jul 13) is sitting in the body.

Emme Parsons (real, 2026-07-25): body has NO date at all. Nothing to parse, so the
extractor invented an `estimatedDeliveryDate` with a wrong year (2025), which anchored
a deadline before the 2026 order date. The resolver must refuse to invent — fall back
to a trustworthy anchor + standard shipping, and mark the result estimated.

---

## Part 2 — The resolver (build this)

Run at ingestion, in `app/api/inbound/route.ts`, before/alongside extraction. Produces
two new persisted fields on `Email` and one derived anchor the deadline math consumes.

**Step 1 — classify forward type.**
- Read raw headers. Auto if a known auto-forward signature is present:
  Gmail = `Return-Path` containing `+caf_=` OR `X-Forwarded-For`/`X-Forwarded-To`.
  (Other providers use different signatures — see decision 1; research per provider,
  do not assume Gmail's marker generalizes.)
- **Default unknown → manual** (conservative: excludes it from receivedAt-anchoring).
- Persist as a new `Email.forwardType` field (`auto` | `manual`). This also replaces
  the hardcoded `"Forwarded by you"` string at the two UI call sites
  (`app/(app)/page.tsx:230`, `app/(app)/emails/[id]/page.tsx:76`).

**Step 2 — resolve the anchor date.**
- If `auto`: anchor = preserved original `Date` header, else `receivedAt`.
- If `manual`: parse the quoted forward block for the original send date. Handle the
  common client formats: Gmail `Date:`, Outlook `Sent:`, Apple Mail variants. Use the
  first that parses to a sane date (year within ~2 years of `receivedAt`).
- If manual AND no quoted date parses: anchor = null (unresolved).
- Persist as a new `Email.anchorDate` (nullable) + a small `Email.anchorSource`
  enum for debuggability (`original_header` | `received_at` | `quoted_body` |
  `unresolved`).

**Step 3 — hand off to deadline math.**
- The deadline computation uses `anchorDate` as its trustworthy reference instead of
  reaching for `receivedAt` directly.
- `anchorDate == null` (unresolved manual) → do NOT compute a confident deadline;
  mark the order's deadline estimated/low-confidence and route to the needs-review
  bucket (reason: "couldn't confirm the date on a forwarded email").

Nothing here blocks or drops an email — worst case is a low-confidence deadline that
gets flagged, never a wrong one shown as fact.

---

## Part 3 — The sanity guard (small, closes the impossible-deadline bug)

Independent of the resolver but belongs in the same effort. A defensive floor that
catches bad dates regardless of source:

- **No extracted date's year is trusted over the anchor.** If any extracted date
  (`estimatedDeliveryDate`, `orderDate`, deadline) lands *before* the order date,
  discard its year and re-derive from `anchorDate` + standard shipping, marking the
  result estimated.
- **A dateless body never yields a fabricated `estimatedDeliveryDate`.** If the source
  has no delivery date present, force the fallback path (`orderDate`/`anchorDate` +
  `STANDARD_SHIPPING_DAYS`) rather than accepting an invented value.
- Make the guard general — validate ANY extracted date's year against the anchor, not
  just the delivery field. (The Fitness Superstore case had the wrong year on
  `orderDate` itself.)

This is the provable-correct half: it holds no matter why the extractor erred.

---

## Part 4 — Open decisions for owner

1. **Which providers beyond Gmail?** Gmail is the only one in current data and the only
   one the probe verified. Do we research Outlook/Yahoo/other auto-forward signatures
   now, or ship Gmail-only + default-everything-else-to-manual and add providers later?
   → ANSWER:

2. **Quoted-date parse scope.** Support Gmail + Outlook + Apple Mail formats at launch,
   or start with Gmail's `Date:` only and let the rest fall to low-confidence?
   → ANSWER:

3. **Unresolved-manual UX.** When a manual forward's date can't be resolved, confirm it
   should land in the needs-review bucket with a plain reason, not silently estimate.
   → ANSWER:

4. **Onboarding push.** Separate from this build: how hard do we push new users onto an
   auto-forward Gmail filter to make manual rare? (Reduces frequency; this resolver
   handles the remainder either way.)
   → ANSWER:

5. **`anchorSource` retention.** Keep the debug enum long-term, or drop it once the
   feature is proven?
   → ANSWER:

---

## Part 5 — What this closes

- `returnDeadline < orderDate` sweep → the Part 3 guard.
- Emme Parsons / dateless invented-year → the Part 3 guard + resolver refusing to
  invent.
- Forward auto/manual mis-classification + "Forwarded by you" mislabel → Part 2 Step 1.
- Unblocks the two features that were waiting on a real forward signal: forward-date
  deadline estimation (now safe for auto-forwards) and any future carrier-link gating.

Stays separate: the ACE VISALIA MessageID dedup (different bug — duplicate rows, not
dates); the Amazon extraction template break.

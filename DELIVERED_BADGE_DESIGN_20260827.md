# Delivered-badge stuck-on-"Arrives" — design pass

Re-scope of the Zara #54421192781 bug (TASKS.md 🔴 Now, diagnosed 2026-08-26,
commit `42348b0`) per owner's 2026-08-27 request. **This is a design doc, not
a fix.** No code changed in `lib/displayStatus.ts`, `lib/linkOrder.ts`,
`lib/orderCardState.ts`, or `lib/extract.ts`. No backfill executed. All
numbers below came from one read-only script:
`scripts/pm-diag-zara-delivered-redesign-20260827.ts` (0 billed Anthropic
calls, 0 DB writes).

---

## 1. Reconciling last session's diagnosis with the owner's observation

Right now, in the DB:

| Field | Value |
|---|---|
| `deliveredAt` | `null` |
| `estimatedDeliveryDate` | `2026-08-24` |
| `deliveryDate` (raw legacy field) | `2026-08-24` |
| `displayStatus` | `"delivered"` |

The card badge (`orderCardChip`'s `awaiting_delivery` branch) reads
**`estimatedDeliveryDate`**. The detail page reads
**`deliveredAt ?? estimatedDeliveryDate ?? deliveryDate`**. Both fields are
now `2026-08-24` — **the same value**. So last session's claim ("both read
Aug 24, resolved") is correct *as of right now*. It was also correct at the
moment it was checked: a same-day `order_confirmation` forward (received
2026-08-26 02:49, extracted 02:51) merged a `deliveryDate` of Aug 24 that
matched the already-set `estimatedDeliveryDate`.

**If you're still seeing an Aug 23/Aug 24 split in the app right now, it is
not a live two-different-fields bug** — the underlying data agrees. The
remaining candidates are a stale page render (client-side cache, a
service-worker cache, or a browser tab that hasn't refetched since before
02:51 on the 26th) or a screenshot taken before that merge landed. **This is
not something a design pass can resolve further — it needs a fresh screen
share or a hard-refresh check in the moment**, flagged as a 🔴 Now item
below rather than closed here.

The actual, confirmed-live bug is unrelated to this drift: `displayStatus`
says `"delivered"`, but the card's own state machine ignores that field for
this rung and only trusts `deliveredAt`, which is `null` — so the badge
still renders "Arrives" instead of switching to a delivered-state chip. That
part of last session's diagnosis stands.

---

## 2. The July 23 gate — already answered, and already built

**The forward auto/manual classifier was not skipped.** It ran as a
read-only probe 2026-07-21 (TASKS.md, "PROBE — carrier-link resolve +
forward-classification audit") and confirmed via raw Postmark headers that
24/34 delivery-typed emails at the time were genuine Gmail auto-forwards
(`+caf_=` Return-Path marker), AquaTru included. That finding became a full
build, **shipped and deployed 2026-07-26** (commit `13521ca`,
`ANCHOR_DATE_RESOLVER.md` Part 2):

- `Email.forwardType` (`"auto" | "manual" | null`), `Email.anchorDate`,
  `Email.anchorSource` — new nullable columns, additive migration.
- `lib/forwardResolver.ts` — `classifyForwardType()` (the exact header
  check the probe validated) and `resolveAnchorDate()`, run once at
  ingestion (`app/api/inbound/route.ts`) on every email since deploy.
- Both hardcoded `"Forwarded by you"` UI strings now read the real field.

Confirmed against the DB directly (not just trusting the doc): **782 of
1230 Email rows have `forwardType` set** — the cutoff is rows received
before the 2026-07-26 deploy, which is exactly the expected boundary, not a
sign the resolver silently stopped running.

**AquaTru, reported first per the original probe's convention:** both of
its delivery emails predate the deploy (received 2026-07-18) — `forwardType:
null` on both, i.e. never re-classified after the fact (the resolver only
runs at ingestion, by design — it doesn't backfill). Re-deriving read-only
for this report: `classifyForwardType` on AquaTru's stored headers still
returns `"auto"`, consistent with the original probe finding.

**No classifier mismatches found** in this pass — the tool this step asked
to search for doesn't exist as a *gap* anymore, it exists as a *shipped
feature not yet exercised on pre-deploy rows*. Nothing to promote to 🔴 Now
here.

---

## 3. Forward-header extraction feasibility — the pivotal number

Across **all 95 delivery-typed emails** in the DB (re-deriving live for the
448 pre-deploy rows that never got classified, using the exact same
`classifyForwardType`/`resolveAnchorDate` functions already in production —
no new logic written for this measurement):

| Outcome | Count | % |
|---|---|---|
| Resolved from original forwarded-header/quoted-body Date | 11 | 11.6% |
| Fell back to `receivedAt` (auto-forward, no parseable header Date) | 84 | 88.4% |
| Fully unresolved (no usable date at all) | 0 | 0% |

**This kills the "primary path" framing as proposed.** The 11 successes are
**100% manual forwards** (`anchorSource: "quoted_body"`) — **zero** of the
84 auto-forwarded delivery emails had a parseable `Date:` header to extract.
`resolveAnchorDate`'s auto-forward branch already tries this
(`findHeaderValue(headers, "Date")` on the raw Postmark headers) and it
simply doesn't fire for any of them — Gmail's auto-forward apparently
doesn't preserve a separately-parseable original-send `Date` header the way
a manually-forwarded, quoted-body email does; the auto-forward's own
Postmark-recorded `Date` header and `receivedAt` are effectively the same
thing already.

Practically, this means: for auto-forwards, there is no meaningful
distinction between "parse the header" and "use `receivedAt`" — they're the
same signal, one is just already computed. The header-parsing path is not a
new option for the auto-forward group; it's a no-op that always degrades to
Fallback A.

**Failure breakdown:** N/A — 0 fully-unresolved rows in this sample. Every
row landed on either a real header/body date or `receivedAt`.

**By retailer:** wide variance (0% for most, 100% for a handful: Tuckernuck,
Freda Salvador, Old Navy, SilkSilky, Ruti, Bettervits USA), but this tracks
forward-type mix per retailer, not retailer-specific parsing failures — no
retailer shows a low success rate *within* the manual-forward subset that
would suggest a broken HTML pattern. Not a finding worth a follow-up.

**Client detection:** not reliably derivable from what's stored — the
resolver's header check only inspects `Return-Path`/`X-Forwarded-For` for
the *auto-forward* signature; it doesn't fingerprint which mail client
authored a *manual* forward's quoted block. Building that would mean parsing
`fromEmail`/header patterns speculatively with no labeled ground truth to
validate against — flagged as infeasible to answer honestly from current
data, not attempted.

**Gmail-dominance check:** the alpha's inbound `fromEmail` domains are
retailer/carrier domains (fedex.com, amazon.com, zara.com, etc.), not the
forwarding user's own mail client — so this dataset can't speak to non-Gmail
forward-client coverage at all, in either direction. The one signal that
*does* exist (the 2026-07-25 design decision) already scoped this
Gmail-only deliberately, "the only provider in current data... don't
research ahead of need." Nothing new to flag.

**Delta distribution (successes only, `anchorDate − receivedAt`):** median
≈ 33 hours, up to ≈ 165 hours (manual-forward lag, as expected — this is the
exact number the original-send-date extraction exists to correct for manual
forwards, and it's working as designed for that group).

---

## 4. Zara #54421192781's delivery email, specifically

| | |
|---|---|
| Stored `forwardType` | `"auto"` |
| Re-derived `forwardType` (sanity check) | `"auto"` (agrees) |
| Body-extracted `deliveryDate` | `null` (no date in the body — this was last session's finding) |
| Resolved `anchorDate` | `2026-08-22T20:41:07Z` |
| Resolved `anchorSource` | `"received_at"` |
| `receivedAt` | `2026-08-22T20:41:07Z` (same instant) |

Per §3, this order's delivery email is exactly the 88% case: auto-forward,
no parseable header, `anchorSource` already resolves to `receivedAt`. **The
"primary path" (header extraction) does not help this order** — it was
never going to, since the header check already ran and already fell
through. The only path that resolves this order is **Fallback A**
(auto-forward `receivedAt` as `deliveredAt`), and per the owner's stated
assumption (retailer sends "delivered" on the actual delivery day,
notification lag ≈ 0), `receivedAt` here is trustworthy: `2026-08-22`, which
matches the order's `orderDate` timeline and the owner's own confirmation
that actual delivery was Aug 22.

---

## 5. Sizing the peer set — the 20-order claim needs correcting

Last session's peer query (`deliveredAt IS NULL AND estimatedDeliveryDate <
now`) returned 20 orders and called it "systemic." Re-examining those 20
against the actual bug mechanism:

| Bucket | Count |
|---|---|
| No delivery-typed email linked at all (never received a delivery signal — different, unrelated situation: package may genuinely not be delivered yet, or user never forwarded that email) | 15 |
| Has a delivery-typed email, but `displayStatus` is `"kept"` (badge shows "Kept," not "Arrives" — `computeOrderCardState` checks `kept` before `deliveredAt`, so these are **not visibly bugged today**) | 2 (Shopbop 142770152, Proenza Schouler 86864) |
| Has a delivery-typed email, `displayStatus: "delivered"`, `deliveredAt: null` — **visibly showing the stuck "Arrives" badge right now** | 3 (Nordstrom 1055864196, Chewy 5199902752, Zara 54421192781) |

**The real, currently-visible bug affects 3 orders, not 20.** All 3 are
auto-forwards where the delivery email's body had no extractable date. All
3 would resolve correctly under Fallback A alone (`receivedAt` as
`deliveredAt` for auto-forwards) — the header-extraction "primary path"
contributes nothing to any of them, per §3/§4.

**Manually-forwarded subset of the 3: zero.** So there is currently no order
in the DB where Fallback B (no usable date) is actually needed. That branch
exists for future manual-forward users, not any current data.

This also reframes the AquaTru precedent: it's the same 3-order shape,
historically — a delivery email, no body date, needing exactly Fallback A.

---

## 6. Design — primary path vs. fallback, reframed by the numbers above

The original ask was "primary path (header) + fallbacks." §3/§4/§5 show the
header path adds nothing for auto-forwards in this dataset — it's not a
primary path that sometimes falls through, it's a path that has a 0%
success rate for exactly the group (auto-forwards) that has the volume.
Restructuring accordingly:

### Option A — Trust `emailTypes.includes("delivery")` at the deliveredAt layer, gated by forward type

For an order whose `displayStatus` derivation would set `"delivered"` via a
linked `delivery`-type email with no body date: if that email's
`forwardType === "auto"`, backfill `deliveredAt = anchorDate` (which is
already `receivedAt` in the 100%-of-auto-forwards case from §3). If
`forwardType === "manual"` or `null` (unclassified/pre-resolver), do **not**
backfill — leave `deliveredAt` null and let the card show the
delivery-pending badge.

- **Files:** `lib/displayStatus.ts` (`deriveDisplayStatus` — no signature
  change needed for the ladder itself, but the deliveredAt-backfill write
  has to happen at the same call site, i.e. `lib/linkOrder.ts`'s
  `recomputeDisplayStatus`, which already has `order.deliveredAt` in scope
  and would need the triggering email's `forwardType`/`anchorDate` added to
  its `select`).
- **Schema change:** none — reuses `forwardType`/`anchorDate`, already
  live since 2026-07-26.
- **Reliability risk:** low for the auto-forward branch — reuses the
  already-proven, already-running resolver output, doesn't add new
  parsing. The only new assumption is "auto-forward `receivedAt` ≈
  delivery day," which is the owner's stated assumption for this session
  and is already load-bearing elsewhere (Fallback A was always going to be
  this).
- **What breaks if the assumption is wrong:** a retailer whose "delivered"
  notification lags the real delivery by more than same-day (e.g., a
  digest email sent hours/days later) would show a slightly-wrong
  `deliveredAt`. Low blast radius: `deliveredAt` only drives the
  awaiting_delivery/returnable rung and the return-deadline countdown
  starting point for `returnWindowStartsFrom: "delivery"` retailers — a
  day or two of skew there is the same order of error the product already
  accepts for `estimatedDeliveryDate`-based deadlines.
- **Manual-forward orders:** stay exactly as they behave today — no
  regression, no improvement. Given §5 found zero currently-affected manual
  orders, this is acceptable to defer rather than solve now.

### Option B — Relax `computeOrderCardState` to trust `displayStatus === "delivered"` directly (no `deliveredAt` requirement)

Drop the O7 invariant's requirement and let the awaiting_delivery/returnable
split read `displayStatus` too: `deliveredAt !== null ||
displayStatus === "delivered"`.

- **Files:** `lib/orderCardState.ts` only.
- **Schema change:** none.
- **Reliability risk:** this is exactly the invariant O7 was written to
  prevent — "two facts about the same order, computed separately,
  disagreeing at runtime" (the "Kept + countdown" bug class the comment
  cites). `displayStatus` can independently race ahead of `deliveredAt` in
  ways `deliveredAt` itself can't (see §2's ladder: `displayStatus`
  advances on email-type presence alone). Reintroducing that dependency
  string-couples two fields the card-geometry build deliberately
  decoupled. Also does nothing for the `returnDeadline` countdown, which
  is a separate consumer of `deliveredAt` (`resolveFallbackOrderDate` and
  delivery-anchored deadline math) — the badge would say "delivered" while
  the deadline still doesn't know when.
- **Recommendation: reject.** Solves the symptom in the one place it was
  reported without solving the underlying data gap, and reopens a bug
  class this codebase already paid down once.

### Option C — Do both: Option A as the real fix, Option B rejected

This is the recommended shape: **Option A only.** Fix the data
(`deliveredAt`) at the source instead of teaching one more consumer to
tolerate its absence — consistent with the "single order state machine, no
independently-computed derivations" principle `orderCardState.ts`'s own
header comment states.

### Fallback for the manual/unclassified group (0 orders today, but real for future users)

Per §5, no current order needs this, but it will recur as manual-forward
users onboard. Two sub-options, not decided here, purely flagged per the
original ask:

- **B1:** Card shows "Delivered" with no specific date when `deliveredAt`
  can't be resolved (`displayStatus === "delivered"` but no anchor at all)
  — a distinct third badge state, not a fabricated date.
- **B2:** Leave it stuck as today until the user manually confirms via a
  new UI affordance. Out of scope for a session — flag as a follow-up if
  chosen.

Not urgent: zero orders in the DB need this branch right now (§5). Worth
deciding before it's needed, not before it exists.

### Backfill plan for the 3 currently-affected orders

Not 20 — **3**: Nordstrom 1055864196, Chewy 5199902752, Zara 54421192781.
All 3 resolve under Option A alone (all `forwardType: "auto"`, all
`anchorSource: "received_at"` already computed and stored). Zero would need
Fallback B. This is a 3-row `UPDATE ... SET deliveredAt = anchorDate WHERE
id IN (...)` — additive-only in effect (fills a null, doesn't change an
existing non-null value) but still a real production data write on
existing rows, so per CLAUDE.md it needs the owner's explicit sign-off on
the exact SQL before it runs, in whatever session actually builds Option A.
Not run here.

The 2 `"kept"` orders (Shopbop, Proenza Schouler) are not part of this
backfill — their badge isn't bugged, and backfilling `deliveredAt` on them
would be a data-completeness nicety, not a user-visible fix. Flagged
separately below rather than bundled in.

---

## 7. TASKS.md promotion candidates

- **🔴 Now (new):** Re-verify the Aug 23/Aug 24 dashboard-vs-detail drift
  live, in the app, since the DB no longer shows two different values (§1).
  If still visible, it's a caching/stale-render bug, not a data bug — needs
  a screen check, not a script.
- **🔴 Now (carry forward, re-scoped):** Build Option A (§6) —
  `lib/linkOrder.ts`'s `recomputeDisplayStatus` backfills `deliveredAt`
  from `anchorDate` when advancing to `"delivered"` via a `delivery`-type
  email whose `forwardType === "auto"`. Includes the 3-row backfill above,
  gated on owner SQL sign-off.
- **Not promoted, correction only:** the "20 peer orders, systemic" framing
  from 2026-08-26 is retracted — real count is 3 visibly-bugged + 2
  latent-but-invisible (`kept`) + 15 unrelated (no delivery email at all).
  No new item needed, just correcting the prior one before it's built
  against the wrong number.
- **Someday / low priority:** decide B1 vs B2 for the manual-forward
  fallback (§6) before it's needed — currently 0 real orders require it, so
  no urgency, but the decision is cheap to make now while the context is
  loaded.

---

## Decisions needed before the next (build) session

- **If you agree deliveredAt should backfill from `anchorDate` for
  auto-forwards with no body date (Option A) →** next session builds it:
  `lib/linkOrder.ts` change + the 3-row backfill, SQL shown for your
  sign-off first.
- **If you'd rather not touch `deliveredAt` derivation at all →** the
  fallback is Option B (relax the card's own invariant), which is not
  recommended above but is the only other lever that changes what the
  badge shows; flag if you want to consider it anyway despite reopening the
  disagreeing-derivations risk.
- **If the Aug 23/Aug 24 drift is still visible live in the app right now**
  (§1) → that's a separate, still-open bug (stale render, not stale data) —
  worth a quick screen-share/hard-refresh check before the next session
  rather than assuming it self-resolved.
- **B1 vs. B2 for the manual-forward fallback (§6)** → no current orders
  need it, so this can wait, but cheap to decide now.

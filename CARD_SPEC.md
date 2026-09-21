# Card Spec — unified four-slot geometry + order state machine

Status: **RECONCILED / SIGNED OFF — build-ready.** Originally drafted 2026-07-25;
Part 5 answered by owner 2026-07-29; final additions (fifth needs-review action,
manual-link picker, summary-tab set) locked 2026-08-10.

This file now folds in `CARD_SPEC_Part5_signoff.md` and the later decisions, so it is
the **single source of truth** — the earlier "where the sign-off and CARD_SPEC differ,
the sign-off wins" override no longer applies. This doc IS the build brief. Hand Part 2
to Claude Code as the single-order-card build, Part 3 as the needs-review bucket build.

Supersedes / absorbs: Needs Review panel UI, mobile audit #3, #4, #5, M2 UI half,
Task 3 four-slot inventory.

---

## What changed since the 2026-07-25 draft (read this first)

Everything below is now decided. The specific reversals/additions relative to the
original draft, so nobody rebuilds a stale version:

- **Bucket name is "Needs review"** everywhere (the mockup's "Need attention" pill is
  wrong — rename it). One name, all surfaces.
- **Slot-4 label is `Keep`** everywhere — the detail page's existing `Keeping it` button
  changes to `Keep`. Do not ship both.
- **Mobile #3 / overflow menu (Q7) is resolved the OPPOSITE way from the draft.** There
  is **no `⋯`, no trash glyph, no swipe/gesture.** The collapsed row is unchanged;
  the expanded state shows `more info` and a single **`Archive`** labeled control —
  **the row stays four controls, not five.** `Delete` is **not** a peer control:
  tapping `Archive` opens a small archive-or-delete prompt (*Archive* keeps the
  record, *Delete* discards it as not-a-purchase). See Part 5 Q7 for the full
  answer and rationale.
  (The original draft's "replace ⋯ with a visible trash icon + always-visible Archive"
  was rejected by the owner for lack of space — do not build it.)
- **The needs-review action set is now FIVE, not four** — `Create new order` was added
  2026-08-10. It is a v1 **registry**, extensible, with an unknown-reason → View-detail
  default.
- **"Link to order" is a manual picker in v1** — the user scrolls the full order list
  and taps the right one. No auto-matching intelligence this pass.
- **Summary tabs are all four:** Due this week / Needs review / Returns in progress /
  Refunds pending. (Navigation above the cards — out of scope for the card build itself;
  see Part 5 Q-extra.)

---

## How to run this on a "push it forward" day

The creative decisions are done. This is now a build, not a design exercise:

1. Hand **Part 2** to Claude Code as the single-order-card + state-machine build brief.
2. Hand **Part 3** as the needs-review bucket brief (reuses the Amazon bundle container).
   They're independent — either can go first.
3. **Do NOT let Amazon extraction bleed in.** The Amazon *card* is built and verified.
   The Amazon *extraction* break (template change) is a separate 🔴 Now bug tracked
   elsewhere — not part of this spec.

---

## Part 1 — The one skeleton

Every card in the app is the same 2x2. Four slots, always in the same corners:

| | Left column | Right column |
|---|---|---|
| **Top** | **Slot 1 — Identity** (logo + retailer) | **Slot 3 — State** (the status chip) |
| **Bottom** | **Slot 2 — Context** (items·price / order # / carrier) | **Slot 4 — Action** (the one right next step) |

This holds at two levels:

- A **single order** is one 2x2.
- A **container** (Amazon bundle, Needs-review bucket) is also a 2x2 in its
  *header*, and it *holds N* order rows, each of which is its own 2x2.

The payoff: slots 3 and 4 on an order are never computed independently — they both
read from one order state machine (Part 2). That is what kills the "Kept + at risk
+ return-by date" label-fighting (mobile audit #4): a kept order is in the Kept
state, and the Kept state has no countdown, so the contradiction is structurally
impossible rather than something the UI has to suppress.

---

## Part 2 — Single order card + the state machine

Slots 3 and 4 are a pure function of the order's product state. One state = one
chip = one action set. **No other code path sets these** — this is the structural fix,
not a suggestion. Auditing out the existing independent chip/badge/action computations
(`OrderCard.tsx`'s `atRisk`/`isClosingSoon()`, `DisplayStatusBadge.tsx`,
`DaysLeftChip.tsx`, `getVisibleActions()`) is part of the build, not just adding the new
function alongside them.

| Product state | When | Slot 2 (context) | Slot 3 (chip) | Slot 4 (action) | Goes to |
|---|---|---|---|---|---|
| **Awaiting delivery** | ordered / in transit, not yet delivered | items · price | `Arrives {date}` (or `{n} days` est.) | `Keep` | Kept |
| **Returnable** | delivered, in window, no decision made | items · price | `{n} days left` | `Keep` · `Start Return` (two buttons) | Kept / Return started |
| **Return started** | Start Return tapped, not dropped off | `{carrier} QR code` | `Return requested` | `Dropped it off?` | Awaiting refund |
| **Awaiting refund** | dropped off / carrier has it | items · price | `Refund pending` (+ `· ${amount}*` when known — see asterisk note) | `Refund received?` | Complete |
| **Kept** | user chose Keep | — | `Kept` | — (auto-archived) | terminal |
| **Complete** | refund confirmed | — | `Refunded` | — (auto-archived) | terminal |

Rules that fall out of this:

- **"Delivered" = `deliveredAt !== null`.** Not `displayStatus`. (This is O7,
  already resolved in the built Amazon card — the state machine must use the same
  test so the two never disagree.)
- **`Keep` is available in "Awaiting delivery"** and archives immediately (Q3).
  Rationale: delivery can't always be confirmed, so a user must be able to Keep
  pre-delivery — otherwise an order whose delivery is never confirmed is stuck with no
  action.
- **Two actions render as two clearly separate buttons**, never one ambiguous
  control (mobile audit #4). `Keep` and `Start Return` are peers.
- **Terminal states auto-archive** the moment they're entered (Keep → archive,
  Complete → archive), no user step (Q8). **Unarchive is also single-step, no warning —
  but an unarchived Kept/Refunded order must return to its terminal chip
  (`Kept`/`Refunded`), NOT a recomputed live countdown.** This is the already-logged
  "unarchive re-surfaces a countdown" bug; it's safe only because slots 3-4 are a pure
  function of state. Ship a test: unarchive a Kept order → `Kept` chip, no countdown.
- **Expand behavior** (the `∨` / `>` on the card): collapsed shows the four slots
  only. Expanded reveals per-item lines (`black jacket … $200`) and the secondary
  controls — `more info` (view detail) and a single **`Archive`** labeled control
  (Q7: no `⋯`, no glyph, no gesture; the row stays four controls, not five).
  **Tapping `Archive` opens a small archive-or-delete prompt** — *Archive* keeps the
  record, *Delete* discards it as not-a-purchase; both end notifications. `Delete`
  lives inside that prompt (not as its own peer control), = junk-with-rescue, own
  confirm, never hard delete. More than N items → "View all" opens a full detail page
  (mirror the Amazon overflow rule — see Part 4; N is the Amazon bundle's existing
  limit, read from code, not re-invented).

### Canonical state mapping (owner-provided 2026-07-25)

The Rosetta Stone between the three vocabularies. The state machine MUST name which
field it reads for slot 3 and writes on each transition — the columns diverge, and
treating them as interchangeable is what produced the "Kept + countdown" and AquaTru
"Shipped forever" bugs.

| What the user sees | Product state (OrderLifecycleState) | Order.status (internal) | Order.displayStatus (live) |
|---|---|---|---|
| Delivered, window open | returnable | returnable | shipped ⚠️ |
| Return started, still have item | return_started | return_started | return_requested |
| Dropped off, waiting on money | awaiting_refund | refund_pending | returned |
| Money back | refunded | completed | refunded |
| Decided to keep | kept | (not listed) ⚠️ | kept |

(Pre-delivery states — ordered / in transit / "Awaiting delivery" — sit above this
table and map to displayStatus `shipped`; they are not part of this mapping.)

**Divergences to confirm in Step 0 before build (CC's read, not owner decisions):**
- ⚠️ **Delivered/returnable shows displayStatus `shipped`.** displayStatus has no
  "delivered" rung, so a delivered order still in its return window reads "Shipped."
  This is the AquaTru "Shipped forever" bug. Slot 3 must NOT read displayStatus alone
  here — use `deliveredAt !== null` (O7) and/or internal `status`.
- ⚠️ **`kept` has no internal `Order.status` value** — it exists only as displayStatus
  `kept` (+ `keptAt`). Confirm intended, or add a status value. (This may force a small
  schema decision — surface it in Step 0, don't silently pick.)
- **Name drift across columns** (awaiting_refund / refund_pending / returned for one
  state; refunded / completed / refunded for another). Not necessarily wrong, but the
  state machine must state which name it reads/writes at each step so the three fields
  never drift apart at runtime.

---

## Part 3 — The Needs-review bucket

This is a **container**, structurally identical to the Amazon bundle — NOT a single
card. It holds N flagged items. Reuse the bundle component/pattern; do not design
a new one.

**[2026-09-17 amendment — two-state framing formalized.** Needs-review is one
concept with two kinds of review item: **routing** and **correction** (reframed
2026-09-18 from the original "two maturity states, proto and confirmed" wording —
see "Two kinds of review item" below). Prior versions of
this section treated the bucket's contents as one undifferentiated pool of
"flagged items," which produced three overlapping definitions across the codebase
(bucket structural query vs. `Email.needsReview` boolean vs. `Order.needsReview`
boolean) and five downstream surfaces silently defaulting to Order-only. See
HISTORY 2026-09-17 for the four-round diagnostic that surfaced this. The two
kinds are defined structurally, share the row shape and control rendering, and
differ only in what reasons apply.**

### Two kinds of review item

Needs Review is one queue that surfaces two kinds of unresolved
decision. They differ in what entity carries the state, what
resolutions apply, and how they're structurally identified —
they are not two lifecycle stages of one record. Most items
resolve without ever passing through the other kind.

- **Routing review — an orphan email awaiting a routing
  decision.** Entity: Email. Structurally:
  `Email.orderId IS NULL AND Email.junkedAt IS NULL`. The app
  has not yet committed to tracking the item. Resolutions:
  link to an existing Order, start a new Order, or discard as
  not-a-purchase. Most routing items resolve to "gone from the
  queue" — link produces a healthy tracked Order, discard
  suppresses the email, create-new-order in the common case
  produces a healthy Order (needsReview=false) that never
  appears in the queue at all.
- **Order correction — a tracked Order flagged for owner
  attention.** Entity: Order. Structurally:
  `Order.needsReview = true`. The Order is in the database and
  being tracked; something about it is flagged (typically a
  missing or ambiguous extracted field). Resolutions: correct
  the flag per its reason, or accept as-is.

**They're related but not stages.** A routing item's "create
new order" resolution can, in the sub-case where extraction
produces an incomplete Order, surface the same underlying
decision as a subsequent correction item on that Order. That's
a genuine transition — but it's the exception path, not the
expected outcome. Most routing items never produce a correction
item. Treating them as sequential lifecycle stages (routing
→ correction) would overclaim; treating them as unrelated would
underclaim. The accurate framing is: two kinds of item that
share a queue and a UI, occasionally one produces the other.

**On the structural definitions above.** These are current
invariants under today's data model, not metaphysical truths
about email or orders. Future features (automated retry
queues, multi-Order emails, additional Order-side review
triggers) may add discriminators that the two-clause structural
tests above can't express on their own. When that happens,
extend the definitions explicitly rather than layering side-
booleans that duplicate the structural state (see the
`Email.needsReview` deprecation for what happens when the
codebase forgets this rule).

Both kinds surface in the same bucket, render as the same 2x2
row shape (below), share the same collapsed/expanded rules,
and share the always-present `View detail` secondary. What
differs is the set of *reasons* — a routing item's reason
describes an email awaiting a decision; a correction item's
reason describes a flag on a tracked Order. The reason →
action tables below are split by kind to make that difference
structural rather than implicit.

**On `Email.needsReview` as a field.** Routing state is *derived* from the two
structural properties above — it is not stored as a boolean on the Email row.
`Email.needsReview` exists in the current schema for historical reasons and is
being deprecated; see 🟡 Next / #3 for the migration and 🟡 Next / #1 for the
related automatic-match bug that produced the linked-but-flagged bug population
(folds into #3 when picked up). Code that needs to know "is this email in routing
state?" must derive from `orderId` and `junkedAt`, not read `Email.needsReview`.

---

**Bucket header** (its own 2x2):

- Slot 1: `Needs review`
- Slot 2: count (`3 items`)
- Slot 3: the attention treatment (orange)
- Slot 4: expand / collapse

**Each row inside** (its own 2x2):

- Slot 1: retailer
- Slot 2: date · amount (e.g. `7/16 · $200`)
- Slot 3: **why** — a full sentence in the app's voice, specific to what's actually
  going on (e.g. `"We think this email belongs to an existing order."`), not a terse
  fragment (`possible duplicate`, `no return policy`) and not a generic catch-all
  (`"This order needs a quick check"`). See the reason → action table below for the
  canonical phrasings.
- Slot 4: **action** — the row's primary action (from the registry below, chosen
  via the state-appropriate reason → action mapping) plus an always-present
  `View detail` secondary and an always-present `Archive`. Rows whose reason has
  no mapped primary action show `Archive` + `View detail` — see "The View-detail
  rule" below.

**Collapsed vs expanded — CORRECTED 2026-08-21, see Part 5 Q10:**

- Collapsed = the first N rows (N = the Amazon bundle's overflow threshold, see
  "Overflow" below), each rendered as its full 2x2 — slot 4's action is **always
  visible**, never gated behind the toggle.
- Expanded = all rows, same full 2x2 per row as collapsed — nothing hidden.
- The toggle governs **row count only** (N rows vs. all rows), never per-row slot
  visibility. (Superseded text, preserved for the record: "Collapsed = compact
  stack of rows showing slots 1–3 only (identity + why, no buttons). Expanded =
  each row reveals its slot-4 action." — this gated the action behind the
  toggle, which owner review of the running build found created two-tap
  friction: expand, then act, instead of one tap straight from the dashboard.)
- **[2026-08-24 amendment, clarified 2026-08-25] Collapsed bucket rows
  expose the row's action controls per the shape below, replacing the
  original "slots 1–3 only, no buttons" text. Rationale: the mockup
  shows the full control set per row without requiring expand; the
  "slots 1–3 only" text drifted from mockup intent during Part 3
  authoring. Owner reconfirmed mockup intent 2026-08-24. Expand still
  reveals per-row detail; the change is which controls are visible
  before expand, not what expand does.**

  **Two shapes, per the mapped-vs-degrade distinction in the View-detail
  rule below** (defined by primary-action shape, not by row position —
  new mapped or degrade reasons can be added to either state's table
  without re-counting):
  - **Mapped row** (any row whose primary action is not `View detail`):
    render three controls — `{primary action, Archive, View detail}`.
  - **Degrade row** (any row whose primary action IS `View detail`):
    render two controls — `{Archive, View detail}`. No duplicate.

  **(2026-08-25 clarification: the earlier amendment text called More
  info "optional third control," and a same-day patch draft
  over-corrected to "always three controls." Both were wrong —
  "optional" hid the mapped-vs-degrade distinction; "always three"
  would produce duplicate View detail buttons on degrade rows. The
  correct rule is two shapes, both consistent with the always-present
  View-detail invariant in the View-detail rule below. CC's
  degrade-row-UI question during the Session-2 build surfaced the
  bug.)**

  **[2026-09-17 note]** The pre-2026-09-17 wording referred to "top four" mapped
  reasons and "bottom three" degrade reasons in the flat table. Both counts were
  already stale relative to the table as of that date (6 mapped + 3 degrade),
  and the table has since been split by state (below). The rule above is now
  stated definitionally — mapped/degrade by primary-action shape — so no counts
  need updating when reasons are added.

**Slot 3 (why) is open-ended. Slot 4 (action) is a v1 registry of FIVE** (Q9 — treat as
an open registry, not a closed set; owner wants room to add actions over time, and the
View-detail degrade default makes that safe):

| Canonical action | UI copy (from mockup) | Effect |
|---|---|---|
| Link to order | "Merge with existing order" | **Manual pick** — user scrolls the full order list and taps the target; the email attaches to it. No auto-matching in v1. |
| Create new order | "Start a new order" | Creates a fresh Order from the email's extracted data and links the email as its first. **Offered when there is no existing order to attach to.** Own confirm step ("Create a new order from this email?"). |
| Not a purchase | "Archive" / junk | junk-with-rescue (reversible), **never hard delete**. |
| View detail | "More info" | opens the item's detail. |
| Nothing | (leave in bucket) | stays flagged, no-op. |

**Reason → action mapping — split by kind (2026-09-17).** Each kind has its own
table. The two tables never share rows: a routing reason cannot apply to a tracked
Order (structurally, no Order exists yet), and a correction reason cannot apply to
an orphan email (structurally, there is no Order to flag). This split replaces
the single flat table used pre-2026-09-17. The mapped-vs-degrade shape
distinction (above) still applies, per-kind.

**Routing reasons — orphan emails awaiting a decision:**

| Reason (slot-3 why — full sentence) | Primary action (slot-4) | Secondary |
|---|---|---|
| "We think this email belongs to an existing order." | Merge with existing order (Link to order) | View detail |
| "We think this may not be e-commerce." | Not a purchase (delete / junk-with-rescue) | View detail |
| "This looks like a duplicate of another order." | Merge with existing order (Link to order) | View detail |
| "This looks like a real purchase with no order record." | Start a new order (Create new order) | View detail |
| "This looks like a return or refund for an order we don't have on file." | Merge with existing order (Link to order) | View detail |
| "Shipping or delivery update — link to the correct order." | Merge with existing order (Link to order) | View detail |
| "We couldn't extract any details from this email." | View detail (degrade — only action) | — |
| any unmapped proto reason | View detail (degrade) | — |

**Correction reasons — flags on tracked Orders:**

| Reason (slot-3 why — full sentence) | Primary action (slot-4) | Secondary |
|---|---|---|
| "We couldn't find a purchase date — the deadline may be estimated." | View detail (degrade — only action) | — |
| "We couldn't find the order total." | View detail (degrade — only action) | — |
| any unmapped confirmed reason | View detail (degrade) | — |

The confirmed table is deliberately thin as of 2026-09-17 — the current set of
confirmed reasons is limited to extraction-completeness flags on already-created
Orders. As more Order-side review triggers are added (e.g. Order-total
discrepancy after a partial refund, return-window-expiring warnings, unverified
return-portal signal from M2), they will extend the confirmed table without
touching the proto one. The thin table reflects present scope, not a design
decision that confirmed reasons should stay few.

- **Why "Create new order" is not redundant with "Link to order":** *Link* assumes a
  target order already exists. An orphaned email is often a real purchase with **no
  order record at all** — nothing to link to — so it must be able to *create* the order,
  not just attach to one.
  **[2026-08-24] Considered adding explicit return/refund → Link-not-Create guidance;
  deferred pending real observed return/refund orphan rows to validate. Branch 2 in
  NEEDS_REVIEW_ROUTING_DESIGN.md implements the behavior in code; spec stays silent
  for now.**
- **"Link to order" is a manual picker in v1.** The user chooses the target from the
  full list themselves. This is deliberately dumb: it sidesteps the "squirrelly sender"
  problem (e.g. a FedEx delivery notification sent by the holding company, not the brand
  merchant) because a human eyeballing the list doesn't care what the sender string
  says. Smarter auto-suggestion is a later refinement, as is search/filter on the list
  once it gets long.
- **The View-detail rule, precisely:** `View detail` is the **always-present secondary
  on every row** — not merely a fallback that shows up when nothing else applies. A
  mapped row (any row whose primary action is not `View detail`, from either state's
  table) shows **[primary action + Archive + View detail]**, three controls. A degrade
  row (any row whose primary action IS `View detail`, from either state's table, plus
  any unmapped reason) shows **[Archive + View detail]**, two controls — there is no
  primary action to pair them with, and `View detail` is never rendered twice. Either
  way, both `View detail` and `Archive` are reachable from every row in the bucket,
  no exceptions.

  **(Superseded text, preserved for the record: "A mapped row … shows [primary action
  + View detail], two controls. A degrade row … shows View detail alone, because there
  is no primary action to pair it with." — those counts were written 2026-08-12
  (`ea939b1`) and were correct when written: `Archive` did not yet exist in the row's
  control set, so there was nothing to omit. The 2026-08-24 amendment D added it, and
  the 2026-08-25 clarification (`c11437e`) restated the shapes WITH `Archive` in the
  "Two shapes" block above — but did not update this bullet, which is where the
  contradiction entered. The 2026-09-17 state-split amendment (`34cbdb4`) edited this
  bullet's row-identification clauses only, replacing the positional "top four" /
  "bottom three" with definitional language, and carried the stale counts through as
  untouched context; its scope was the table restructure, not control rendering.
  Corrected 2026-09-20 to match the "Two shapes" block, which is authoritative on
  control counts. The same correction was applied to the Slot 4 bullet above, which
  carried an identical "`View detail` alone" claim. Act 1 shipped `Archive` on every
  row the same day, commit `5e45f0f` — `app/NeedsReviewRow.tsx` renders it
  unconditionally across both kinds, dispatching to junk-with-rescue for email-kind
  and reversible `archivedAt` for order-kind.)**
- **Any reason with no registered mapping — proto or confirmed — degrades to
  `View detail`.** Never throws. This is what lets the bucket ship before every
  possible reason is mapped, and what makes the registry safely extensible: a new
  reason string can be added at any time without a matching action existing yet,
  and the row still works.
- **[2026-08-24] "We couldn't extract any details from this email" is deliberately
  distinct from a generic "some details are uncertain" sentence** — it covers the
  zero-extraction case (no retailer, no order number, nothing to go on), not a
  partial-extraction case where specific fields are identifiably missing. Don't
  collapse the two; they're different claims about how much the system actually knows.
- **Populations that feed this bucket** (from the four-slot inventory), grouped by
  state:
  - **Proto:** orphaned genuine-commerce emails, duplicates, extraction failures,
    and possible non-commerce (no detector yet, reason/action pair reserved —
    not yet built).
  - **Confirmed:** Orders with `needsReview = true` due to missing or ambiguous
    extracted fields (per the confirmed reasons table).

  Each row just needs a slot-3 reason string (full sentence, per the tables
  above) and inherits its slot-4 action from the state-appropriate mapping;
  unknown → View detail.

  **[2026-09-17 historical note, corrected 2026-09-19]** A prior
  version of this list named a fourth population — "linked-but-
  flagged emails" — with `orderId` set AND
  `Email.needsReview = true`. The 2026-09-17 framing session
  described this population as a bug artifact from an auto-match
  path failing to clear a routing flag. **That description was
  wrong.** Session B Phase 1 investigation (2026-09-18) established
  that `Email.needsReview` is not a routing flag at all — it is
  the AI extraction engine's confidence signal, and the ~425 rows
  in that population (count as of 2026-09-18; 108 was a stale
  2026-07-23 figure the 09-17 session repeated without re-verifying)
  are correctly-linked emails where extraction happened to be
  uncertain. Not a bug. The actual mis-behaving code is the
  opposite of what was originally claimed: the manual link/create
  paths at `lib/orderReview.ts` erase the AI's extraction-quality
  signal whenever a user acts on an orphan, silently corrupting
  the field. See HISTORY 2026-09-19 for how the misreading
  propagated and how the deprecation decision (🟡 Next #3) still
  holds under corrected reasoning.

**Overflow:** the bucket can hold 3 today and 15 after a bad extraction week. The
bucket's own collapse/expand toggle (see "Collapsed vs expanded" above, corrected
2026-08-21) already reveals every row inline once expanded — `View all {N} →` to
a dedicated page is a parallel shortcut reachable from the **collapsed** state,
for reading many rows on their own page rather than scrolling them inline on the
dashboard; once expanded, nothing is hidden left to link to, so the link only
needs to show when collapsed. **Reuse the Amazon bundle's threshold — do not
invent a second number** (read the literal from `lib/amazonBundle.ts` in Step 0
— confirmed 2026-08-21: the literal `5` lives in `app/AmazonBundleCard.tsx`,
`lib/amazonBundle.ts` itself holds no threshold constant).

---

## Part 4 — Amazon bundle (reference pattern, already built)

The Amazon bundle card is built and production-verified. It IS the container
pattern the Needs-review bucket copies: collapses to a summary row, expands to a
list, overflows to a full page past its item limit. Header is a 2x2 (identity =
Amazon, context = "7 orders", state = earliest-deadline chip, action =
expand/collapse). Do not re-solve container behavior from scratch — point at this.

Note kept separate: Amazon *extraction* is currently broken by a template change.
That's a 🔴 Now bug, unrelated to this spec.

---

## Part 5 — Decisions (RESOLVED — recorded inline)

All nine original open questions are answered; the answers are locked below. Two later
additions (the fifth action and the summary-tab set) are recorded after them.

1. **Bucket name → "Needs review"** everywhere. The expanded mockup's "Need attention"
   pill is wrong — change it to match. One name, all surfaces.
   → **ANSWER: Needs review.**

2. **Overflow threshold → reuse the Amazon bundle's inline limit** (believed 5) before
   "View all," for both the needs-review bucket and expanded order cards. Not a
   decision — CC reads the literal from `lib/amazonBundle.ts`. Do not invent a second
   number.
   → **ANSWER: reuse the Amazon bundle limit; confirm the literal in code.**

3. **Keep before delivery → yes.** `Keep` is available in "Awaiting delivery" and
   archives immediately, so an order whose delivery is never confirmed is never stuck
   with no action.
   → **ANSWER: yes, Keep available pre-delivery, archives immediately.**

4. **Slot-4 action copy → approved as written:** `Keep`, `Start Return`,
   `Dropped it off?`, `Refund received?`. The detail page's existing `Keeping it` button
   is renamed to `Keep` so both surfaces match.
   → **ANSWER: approved; `Keeping it` → `Keep` on the detail page.**

5. **Slot-3 chip copy → approved, with one revision:** `Arrives {date}`, `{n} days left`,
   `Return requested`, **`Refund pending`** (revised from `Returned {date}`), `Kept`,
   `Refunded`.
   → **ANSWER: approved; awaiting-refund chip revised to `Refund pending` (see the v1
   refund-pending assumptions note under Part 2).**

   **v1 refund-pending assumptions (locked as defaults, to be tested/optimized later,
   2026-08-10):** the interesting thing in the awaiting-refund state is *money owed and
   not yet arrived*, not the fact of return — so the chip leads with `Refund pending`
   (+ amount when known), context stays items·price because the price is what's being
   refunded, and the action stays `Refund received?`.

   **Amount caveat — the `*` is mandatory, not cosmetic.** We never ask *which* items of
   a multi-item order were returned, so the amount owed is unknown for any partial
   return — the order total is only a **ceiling**. Therefore the amount renders with an
   asterisk (`· $200*`) carrying a footnote/expand gloss: "Full order total — we don't
   track which items were returned, so your refund may be less." Rules: single-item
   orders are unambiguous and MAY show the amount without the asterisk; multi-item orders
   MUST asterisk it (or omit the amount — see alt below). Never show a bare multi-item
   amount as if it were confirmed.
   - *Alt to test later:* on multi-item orders, drop the number entirely and show just
     `Refund pending` (no false precision), or phrase it `up to $200`. A/B once there's
     data.

   **Not v1, flagged for a later test:** an "overdue" treatment (escalate visually /
   prompt "chase it up" once a refund has been pending past ~10 business days). These are
   assumptions, not validated — the whole state is a candidate for A/B once there's real
   data.

6. **View detail → expand in place first.** Tapping reveals more detail inline on the
   dashboard; navigation to a separate detail page is the deeper tier, not the first
   step. Progressive disclosure.
   → **ANSWER: expand in place; separate page is the deeper tier.**

7. **Overflow menu (mobile #3) → NO glyph, NO `⋯`, NO swipe/gesture.** The collapsed row
   is unchanged (four slots + `∨`). Removing the ambiguous glyph *is* the mobile-#3 fix.
   In the expanded state the secondary controls are `more info` (view detail) and a single
   **`Archive`** labeled control — the row stays **four controls, not five**. **Delete is
   not a peer control: tapping `Archive` opens a small archive-or-delete prompt** —
   *Archive* keeps the record, *Delete* discards it as not-a-purchase; both end
   notifications. `Delete` = junk-with-rescue, own confirm, never hard delete. Rationale:
   Delete is the rarest and most consequential action on an order card, so it's one
   deliberate step in under a clearly-labeled control, not surfaced as a destructive peer.
   → **ANSWER: collapsed row unchanged; expanded shows `more info` + `Archive`; Delete
   lives inside an archive-or-delete prompt under `Archive`. (Reverses the draft's "trash
   icon" proposal; row stays four.)**

   **Future / not v1 (backlog, owner-flagged 2026-08-10):** when a user deletes, ask
   *why* (e.g. `not ecommerce`, `duplicate`) and store it — that reason is a training
   signal that could later drive auto-classification of the needs-review bucket. Applies
   to both this card's Delete and the bucket's "Not a purchase" action. Not built in this
   pass.

8. **Kept / Complete auto-archive → yes, no second step. Unarchive also single-step, no
   warning.** Safe *only* because the state machine holds: an unarchived Kept/Refunded
   order returns to its terminal chip, never a recomputed live countdown (the
   already-logged bug). Ship the unarchive-a-Kept-order test.
   → **ANSWER: auto-archive on entry; single-step unarchive; terminal chip on return,
   guaranteed by the state machine.**

9. **Needs-review action set → v1 registry, now FIVE actions** (Link to order / Create
   new order / Not a purchase / View detail / Nothing). "Not a purchase" =
   junk-with-rescue, never hard delete. Open registry with the unknown → View-detail
   degrade default; new actions can be added without touching existing ones.
   → **ANSWER: five actions as above; extensible registry; View-detail fallback.**

**Q-extra (added 2026-08-10) — Summary tabs.** The top summary strip (navigation above
the cards) reads all four queues: **Due this week / Needs review / Returns in progress /
Refunds pending.** Note: *Returns in progress* and *Refunds pending* overlap (a
dropped-off order awaiting refund arguably sits in both) — decide whether they collapse
into one or read as two pipeline stages once the real screen exists. **Out of scope for
this card build** (the tabs are navigation, not cards) — flagged here so it isn't lost.
→ **ANSWER: all four; reconcile the returns/refunds overlap later, on the real screen.**

**Q10 (correction, added 2026-08-21) — Needs-review bucket collapse/expand: what
does the toggle govern?** Originally (Part 3's "Collapsed vs expanded" bullet,
now corrected above): collapsed showed slots 1-3 only on every visible row, with
slot 4 (the action) gated behind expanding the bucket — a design carried over
from the single-order-card's own expand-to-reveal-more-controls pattern (Part 2).
Built literally as written, then reviewed against a running preview by the
owner: this produced two-tap friction on the dashboard (expand the bucket, THEN
tap the row's action) instead of the one-tap access the bucket exists to
provide. **CORRECTION:** the toggle governs row COUNT only (N rows collapsed vs.
all rows expanded); every rendered row is always its full 2x2, slot 4 included,
regardless of collapse state. This also reconciles the "Overflow" bullet
(directly below Part 3's row spec) with this one — see that bullet's
2026-08-21 update for how the two now compose (inline expand vs. the dedicated
`/needs-review` page are parallel shortcuts, not the same mechanism).
→ **ANSWER: toggle = row count only; slot 4 is always visible on every rendered
row, collapsed or expanded.**

---

## Part 6 — What this replaces

When this spec is built, close these items (they're all facets of it):

- Needs Review panel UI
- Mobile audit #3 (overflow menu) — resolved via Q7 (glyph removed; actions move into
  the expanded state — NOT a trash icon)
- Mobile audit #4 (state-label contradictions + button hierarchy) — solved
  structurally by the single state machine driving slots 3 + 4
- Mobile audit #5 (quick-check / review disclosure surface) — the Needs-review bucket
- M2 return-portal — UI half (the "unverified portal" reason is just another slot-3
  reason string in the bucket)
- Task 3 four-slot inventory — the populations map to bucket rows

Not covered here (stay separate): Amazon extraction template bug; the
`returnDeadline < orderDate` root cause; the orphaned-email matcher (the *automated*
version — v1's manual "Link to order" picker deliberately doesn't need it); the summary
tabs' final shape (Q-extra — navigation, not cards).

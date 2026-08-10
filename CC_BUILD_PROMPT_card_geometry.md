# CC BUILD PROMPT — Unified card geometry + order state machine + needs-review bucket

You are implementing the card system specified in `CARD_SPEC.md`. All open questions are
resolved and recorded inline in the spec's Part 5. This is a **build** task (writes code),
but on a branch, no push, preview-first — see Rules. Turn the spec into working UI in the
existing app; do not redesign it.

---

## Read first (session entry point)
1. `CLAUDE.md` — operating contract + house rules. Obey over this prompt.
2. `TASKS.md` — current board. Find the "Unified card geometry + order state machine"
   item; this prompt builds it.
3. `CARD_SPEC.md` — **the single source of truth.** Part 1 (skeleton), Part 2
   (single-order card + state machine), Part 3 (needs-review bucket), Part 4 (Amazon
   bundle = the pattern to copy), Part 5 (all decisions, answered inline).
   - **The spec now absorbs the former `CARD_SPEC_Part5_signoff.md`** — that file is
     superseded and is NOT a second authority. If it's still in the repo, ignore it as a
     source; the spec wins on every point.
5. `BUILD.md` — data model / invariants for order state + linking.

**If any repo file disagrees with this prompt, follow the repo file (esp. CARD_SPEC.md)
and flag it.** Do not build from this prompt over the source.

---

## Step 0 — reconcile before writing a line (read-only)
- Confirm the build item still reads as expected on the current `TASKS.md`.
- Locate the existing Amazon bundle implementation (`lib/amazonBundle.ts` + its card
  component). It is production-verified and is the container pattern Part 3 copies and the
  overflow/expand pattern Part 2 mirrors — **reuse it, do not re-solve container
  behavior.**
- Read the literal inline-overflow limit from that code (CARD_SPEC Q2 = reuse it, do NOT
  invent a second number). Report the number; use it for both the needs-review bucket and
  expanded order cards.
- Identify where order state currently lives and how `deliveredAt` / `status` /
  `displayStatus` are read (CARD_SPEC "O7": delivered = `deliveredAt !== null`, never
  `displayStatus`). Report the current shape before changing anything.
- Resolve the three ⚠️ mapping divergences in CARD_SPEC Part 2 by reading the code, and
  report them — do NOT silently pick. In particular: `kept` has no internal `Order.status`
  value (confirm intended or surface a schema decision), and delivered/returnable reads
  displayStatus `shipped` (the "Shipped forever" bug — slot 3 must not read displayStatus
  alone here).

## Build A — single-order card + state machine (CARD_SPEC Part 2)
- One 2×2: Slot 1 identity, Slot 2 context, Slot 3 chip, Slot 4 action.
- **Slots 3 and 4 are a pure function of one order state** (the Part 2 table). No other
  code path sets the chip or the action. This is the structural fix for the
  "Kept + countdown" class of bug — a state simply has no countdown, so the contradiction
  can't be rendered. **Audit out the existing independent computations** (`OrderCard.tsx`
  `atRisk`/`isClosingSoon()`, `DisplayStatusBadge.tsx`, `DaysLeftChip.tsx`,
  `getVisibleActions()`) — adding the new function while leaving these live re-creates the
  contradiction.
- States + chip + action exactly per CARD_SPEC Part 2:
  - Awaiting delivery → chip `Arrives {date}` / `{n} days` · action `Keep`
    (**Keep IS available pre-delivery** and archives immediately).
  - Returnable → chip `{n} days left` · actions **two distinct buttons** `Keep` +
    `Start Return` (never one ambiguous control — mobile #4).
  - Return started → chip `Return requested` · action `Dropped it off?`.
  - **Awaiting refund → chip `Refund pending` (+ `· ${amount}*` when known) · action
    `Refund received?`.** The chip leads with the pending refund, NOT "Returned {date}".
    **The `*` is mandatory on multi-item orders:** we don't track *which* items were
    returned, so the amount is the full-order ceiling, not a confirmed figure — asterisk
    it with the gloss "Full order total — we don't track which items were returned, so
    your refund may be less." Single-item orders may show the amount without the asterisk.
    Never render a bare multi-item amount as if confirmed. (See CARD_SPEC Part 5 Q5 for
    the v1 assumptions + the alt-to-test.)
  - Kept → chip `Kept` · no action · auto-archived.
  - Complete → chip `Refunded` · no action · auto-archived.
- Slot-3 / Slot-4 copy: exactly the CARD_SPEC Part 2 + Part 5 strings. Note `Keep` is the
  approved slot-4 label; the detail page's existing `Keeping it` button is **renamed to
  `Keep`** (one name, both surfaces — do not ship both).
- **Expand = progressive disclosure in place** (Q6): collapsed shows the 4 slots only;
  one tap reveals per-item lines AND the secondary actions. Past the overflow limit,
  "View all" → the full detail page (mirror the Amazon overflow rule).
- **Overflow menu / mobile #3 (Q7):** NO `⋯`, NO glyph on the collapsed row, **NO
  swipe/gesture** (explicitly ruled out). In the expanded state the secondary controls are
  `more info` (view detail) and a single **`Archive`** labeled control — **the row stays
  four controls, not five.** **Delete is NOT a peer control:** tapping `Archive` opens a
  small archive-or-delete prompt (*Archive* keeps the record, *Delete* discards as
  not-a-purchase; both end notifications). `Delete` lives inside that prompt, =
  junk-with-rescue, own confirm, never hard delete.
  - *(Future, NOT this pass — backlog:* on delete, ask why (`not ecommerce` / `duplicate`)
    and store it as a training signal for later bucket auto-classification. Do not build.)
- **Auto-archive (Q8):** Kept and Complete archive immediately, no user step. Unarchive
  is also single-step, no warning — **BUT** an unarchived Kept/Refunded order must return
  to its terminal chip, NOT a recomputed live countdown. Because slots 3-4 are a pure
  function of state, this must hold by construction. Add a test that unarchiving a Kept
  order shows `Kept` and no countdown (this is the previously-logged bug).

## Build B — needs-review bucket (CARD_SPEC Part 3)
- It is a **container**, structurally the Amazon bundle — not a new component. Reuse the
  bundle pattern (header 2×2 + N rows, collapse/expand, overflow → "View all" at the same
  limit from Step 0).
- Header 2×2: `Needs review` / count / orange attention treatment / expand-collapse.
- Each row 2×2: retailer / `date · amount` / **why** (open free-text, e.g.
  `possible duplicate`, `no return policy`) / **action** (from the registry below).
- Collapsed = rows showing slots 1-3 (identity + why, no buttons); expanded = each row
  reveals its action.
- **Action set = an open registry, v1 = FIVE** (Q9). Build it so new actions can be added
  without touching existing ones:
  1. **Link to order** ("Merge with existing order") — **manual pick in v1: the user
     scrolls the full order list and taps the target order.** No auto-matching /
     suggestion this pass (search-filter on the list is a later refinement). This
     deliberately sidesteps the "squirrelly sender" case (e.g. a FedEx notification sent
     by the holding company, not the brand).
  2. **Create new order** ("Start a new order") — creates a fresh Order from the email's
     extracted data and links the email as its first. **Offered when there is no existing
     order to attach to.** Gets its **own confirm step** ("Create a new order from this
     email?"), matching the existing junk-with-rescue confirm pattern.
  3. **Not a purchase** ("Archive") — junk-with-rescue, reversible, **never hard delete**.
  4. **View detail** ("More info") — opens the item's detail.
  5. **Nothing** — leave in bucket, no-op.
  - **Any reason with no registered action degrades to View detail — never throws.** This
    is what makes the registry safely extensible.

## Naming reconciliations (apply, don't reintroduce)
- Bucket + its summary-stat pill both read **"Needs review"** (the mockup's "Need
  attention" pill is wrong — fix it). One name, all surfaces.
- Slot-4 label is **`Keep`**; rename the detail page's `Keeping it` to `Keep`. Do not ship
  both.

## Out of scope (do NOT touch this pass)
- The top summary tabs. (Owner has since decided the set = **all four**: Due this week /
  Needs review / Returns in progress / Refunds pending — with the Returns/Refunds overlap
  to reconcile later. But the tab strip is navigation *above* the cards, NOT part of this
  card build. Leave as-is; do not build or change it here.)
- Amazon extraction template bug; the anchor-date / deadline backend; the *automated*
  orphaned-email matcher (v1's manual "Link to order" picker deliberately doesn't need
  it). UI only.

## Rules (house)
- **Branch only. Do NOT push. Do NOT merge.** Build on a feature branch, commit locally,
  and STOP for owner review in the browser before anything leaves the machine. (Standing
  rule: no push without explicit command.)
- Reflect this build into 🔴 Now before starting if it isn't already.
- Any probe that calls the model states an estimated call count BEFORE running. This
  build is UI + local dev; expected model calls = 0 unless you run extraction — if a step
  would, stop and estimate first.
- Prefer the existing bundle component/utilities over new abstractions. Match the app's
  current styling tokens; do not introduce a new design system.
- At close, report: branch name, files changed, commits (local only), what to click to
  preview it, billed API calls with call sites (expected 0), and anything that disagreed
  with this prompt.

## Definition of done (for owner review, not auto-merge)
- Single-order card renders all six states correctly from real order data, chip + action
  driven solely by state.
- Awaiting-refund shows `Refund pending` (+ asterisked amount on multi-item orders), NOT
  `Returned {date}`.
- Two-button Keep / Start Return in Returnable; no ambiguous control anywhere.
- Expand shows detail + `more info` and a single `Archive` control (row stays four); no
  ⋯, no gesture. Delete lives inside an archive-or-delete prompt under `Archive`, behind
  its own confirm.
- Needs-review bucket renders as a bundle-pattern container with the **five** actions +
  View-detail fallback; Link-to-order opens a manual order picker; Create-new-order has
  its own confirm.
- Unarchive-a-Kept-order test passes (terminal chip, no countdown).
- Running on a branch, nothing pushed, preview instructions in the close-out.

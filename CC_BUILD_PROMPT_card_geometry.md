# CC BUILD PROMPT — Unified card geometry + order state machine + needs-review bucket

You are implementing the card system specified in `CARD_SPEC.md`, now that all of its
Part 5 open questions are answered. This is a **build** task (writes code), but on a
branch, no push, preview-first — see Rules. Turn the spec into working UI in the existing
app; do not redesign it.

---

## Read first (session entry point)
1. `CLAUDE.md` — operating contract + house rules. Obey over this prompt.
2. `TASKS.md` — current board. Find the "Unified card geometry + order state machine"
   item; this prompt builds it.
3. `CARD_SPEC.md` — the spec. Part 1 (skeleton), Part 2 (single-order card + state
   machine), Part 3 (needs-review bucket), Part 4 (Amazon bundle = the pattern to copy).
4. `CARD_SPEC_Part5_signoff.md` — the 9 resolved decisions + Q7 resolution + carry-in
   traps. **Where the sign-off and CARD_SPEC's draft text differ, the sign-off wins.**
5. `BUILD.md` — data model / invariants for order state + linking.

**This prompt may be written against a stale board.** If any of the above disagrees with
this prompt, follow the repo file and flag it. Do not build from this prompt over the
source.

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

## Build A — single-order card + state machine (CARD_SPEC Part 2)
- One 2×2: Slot 1 identity, Slot 2 context, Slot 3 chip, Slot 4 action.
- **Slots 3 and 4 are a pure function of one order state** (the Part 2 table). No other
  code path sets the chip or the action. This is the structural fix for the
  "Kept + countdown" class of bug — a state simply has no countdown, so the contradiction
  can't be rendered.
- States + chip + action exactly per Part 2 and the sign-off:
  - Awaiting delivery → chip `Arrives {date}` / `{n} days` · action `Keep`
    (**Keep IS available pre-delivery** — Q3 — and archives immediately).
  - Returnable → chip `{n} days left` · actions **two distinct buttons** `Keep` +
    `Start Return` (never one ambiguous control — mobile #4).
  - Return started → chip `Return requested` · action `Dropped it off?`.
  - Awaiting refund → chip `Returned {date}` · action `Refund received?`.
  - Kept → chip `Kept` · no action · auto-archived.
  - Complete → chip `Refunded` · no action · auto-archived.
- Slot-3 / Slot-4 copy: exactly the sign-off strings (Q4, Q5).
- **Expand = progressive disclosure in place** (Q6): collapsed shows the 4 slots only;
  one tap reveals per-item lines AND the secondary actions. Past the overflow limit,
  "View all" → the full detail page (mirror the Amazon overflow rule).
- **Overflow menu / mobile #3 (Q7):** NO `⋯`, NO glyph on the collapsed row, **NO
  swipe/gesture** (explicitly ruled out). `Archive` and `Delete` are **labeled text
  controls inside the expanded state**. `Delete` = junk-with-rescue, own confirm, never
  hard delete.
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
  `possible duplicate`, `no return policy`) / **action** (from the set below).
- Collapsed = rows showing slots 1-3 (identity + why, no buttons); expanded = each row
  reveals its action.
- **Action set = an open registry, v1 = four** (Q9): Link to order ("Merge with existing
  order") · Not a purchase ("Archive", junk-with-rescue, **never hard delete**) · View
  detail ("More info") · Nothing (leave in bucket). **Any reason with no registered
  action degrades to View detail — never throws.** Build it so new actions can be added
  without touching existing ones.

## Naming reconciliations (sign-off carry-in — apply, don't reintroduce)
- Bucket + its summary-stat pill both read **"Needs review"** (the mockup's "Need
  attention" pill is wrong — fix it). One name, all surfaces.
- `Keep` (slot-4, approved) vs `Keeping it` (current detail-page button): make them
  consistent, or flag if they must differ. Do not ship both silently.

## Out of scope (do NOT touch this pass)
- The differing top summary tabs across mockups (Due-this-week / refunds-pending vs
  three-tab) — not a Part 5 item; leave as-is, flag for owner.
- Amazon extraction template bug; the anchor-date / deadline backend; the orphaned-email
  matcher. UI only.

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
- Two-button Keep / Start Return in Returnable; no ambiguous control anywhere.
- Expand shows detail + Archive/Delete labeled controls; no ⋯, no gesture.
- Needs-review bucket renders as a bundle-pattern container with the four actions +
  View-detail fallback.
- Unarchive-a-Kept-order test passes (terminal chip, no countdown).
- Running on a branch, nothing pushed, preview instructions in the close-out.

# CARD_SPEC Part 5 — SIGNED OFF (owner, 2026-07-29)

Per CARD_SPEC's own terms, Part 5 answered = the spec is the build brief. Part 2
(single-order card + state machine) and Part 3 (needs-review bucket) are now unblocked
for Claude Code. This file records the resolved decisions and the items to carry into
the build so the known inconsistencies don't get reintroduced.

## The 9 decisions (resolved)

1. **Bucket name → "Needs review"** everywhere. Carry-in: the summary-stat pill in the
   expanded mockup reads "Need attention" — change it to match. One name, all surfaces.
2. **Overflow threshold → reuse the Amazon bundle's inline limit** (do not invent a
   second number) before "View all." The number (believed 5) is read from
   `lib/amazonBundle.ts`, not re-decided here — confirm the literal in code.
3. **Keep before delivery → yes, Keep is available in "Awaiting delivery"** and archives
   immediately. Rationale (record it): delivery can't always be confirmed, so a user
   must be able to Keep pre-delivery — otherwise an order whose delivery is never
   confirmed would be stuck with no action.
4. **Slot-4 action copy → approved as written:** `Keep`, `Start Return`,
   `Dropped it off?`, `Refund received?`. (See carry-in on "Keep" vs "Keeping it.")
5. **Slot-3 chip copy → approved as written:** `Arrives {date}`, `{n} days left`,
   `Return requested`, `Returned {date}`, `Kept`, `Refunded`.
6. **View detail → expand in place first.** Tapping reveals more detail inline on the
   dashboard; navigation to a separate detail page is the deeper tier, not the first
   step. Progressive disclosure.
7. **Overflow menu (mobile #3) → recommendation below** (owner rejected always-visible
   trash+Archive for lack of space).
8. **Kept/Complete auto-archive → yes, no second step. Unarchive also single-step, no
   warning.** Safe *only* if the state machine holds (see carry-in).
9. **Needs-review action set → four confirmed** (Link to order / Not a purchase / View
   detail / Nothing), "Not a purchase" = junk-with-rescue, never hard delete. **Treat
   as a v1 registry, not a closed set** — owner wants room to add actions over time. The
   existing "unknown reason → View detail" degrade rule already provides safe
   extensibility; build it as an open registry with that default.

## Q7 — ⋯ replacement (recommendation)

Constraint: the collapsed row (avatar · name · items·price · chip · `∨`) has no room for
added controls. **No swipe/gesture actions** (previously ruled out — not intuitive).
Resolution reuses the Q6 answer — tap-to-expand carries the actions, not just detail:

- **Collapsed row unchanged** — four slots + `∨`, no ⋯, no glyph. Removing the ambiguous
  glyph *is* the mobile-#3 fix; we don't replace it.
- **Expanded state shows `Archive` and `Delete` as labeled text controls** (words, not
  icons) beside the per-item detail. `Delete` = junk-with-rescue, own confirm, never hard
  delete.
- **That is the whole path.** One tap reveals detail + secondary actions together. No
  quick-action layer, no gesture, no collapsed-row space added.

## Carry into the build (don't reintroduce these)

- **Q8 depends on the state machine.** An unarchived Kept/Refunded order must return to
  its terminal chip (`Kept`/`Refunded`), NOT a recomputed live countdown. This is the
  already-logged "unarchive re-surfaces a countdown" bug. No warning + correct terminal
  state = fine; no warning + recomputed state = the bug returns. The single-step
  unarchive is only safe because slots 3-4 are a pure function of product state.
- **"Keep" vs "Keeping it."** Slot-4 (approved) says `Keep`; the built detail pages say
  `Keeping it`. Same action, two surfaces — decide whether they align or intentionally
  differ before build.
- **Q2 number** is a code read (`lib/amazonBundle.ts`), not a decision.
- **Q9 registry** — four actions are v1; architecture must allow adding without breaking,
  via the View-detail degrade default.

## Out of Part 5 scope (noticed, not decided here)
- The top summary tabs differ across mockups (expanded: Due this week / Need attention /
  Returns in progress; collapsed: due this week / refunds pending). Not a Part 5
  question — flag for owner separately.

## Now unblocked
- Part 2 → single-order card + state machine build brief for CC.
- Part 3 → needs-review bucket brief for CC (reuses the Amazon bundle container pattern).
- On approval + build, close the items CARD_SPEC Part 6 lists (Needs Review panel UI,
  mobile audits #3/#4/#5, M2 UI half, Task 3 four-slot inventory).

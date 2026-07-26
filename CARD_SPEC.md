# Card Spec — unified four-slot geometry + order state machine

Status: DRAFT for owner sign-off. Written 2026-07-25.
Supersedes / absorbs: Needs Review panel UI, mobile audit #3, #4, #5, M2 UI half,
Task 3 four-slot inventory. Once approved, this doc IS the build brief for all of them.

---

## How to run this on a "push it forward" day

You do NOT need to re-think the design to move this. Work top to bottom:

1. **Answer Part 5 (Open decisions).** ~10 focused minutes. Nine yes/no or
   pick-one questions. Everything downstream is blocked on these, nothing else is.
   Write your answers inline in Part 5 and that's the whole creative ask for the day.
2. **Once Part 5 is answered**, hand Part 2 to Claude Code as the single-order-card
   build brief, then Part 3 as the needs-review bucket brief. They're independent —
   either can go first.
3. **Do NOT let Amazon extraction bleed in.** The Amazon *card* is built and
   verified. The Amazon *extraction* break (template change) is a separate 🔴 Now
   bug tracked elsewhere — not part of this spec.

If you only have energy for step 1, that's still a good day: it unblocks everything.

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
chip = one action set. No other code sets these.

| Product state | When | Slot 2 (context) | Slot 3 (chip) | Slot 4 (action) | Goes to |
|---|---|---|---|---|---|
| **Awaiting delivery** | ordered / in transit, not yet delivered | items · price | `Arrives {date}` (or `{n} days` est.) | Keep | Kept |
| **Returnable** | delivered, in window, no decision made | items · price | `{n} days left` | **Keep** · **Start Return** (two buttons) | Kept / Return started |
| **Return started** | Start Return tapped, not dropped off | `{carrier} QR code` | `Return requested` | Dropped it off? | Awaiting refund |
| **Awaiting refund** | dropped off / carrier has it | items · price | `Returned {date}` | Refund received? | Complete |
| **Kept** | user chose Keep | — | `Kept` | — (auto-archived) | terminal |
| **Complete** | refund confirmed | — | `Refunded` | — (auto-archived) | terminal |

Rules that fall out of this:

- **"Delivered" = `deliveredAt !== null`.** Not `displayStatus`. (This is O7,
  already resolved in the built Amazon card — the state machine must use the same
  test so the two never disagree.)
- **Two actions render as two clearly separate buttons**, never one ambiguous
  control (mobile audit finding, owner-flagged in mockup: "need to be clearly two
  action buttons"). Keep and Start Return are peers.
- **Terminal states auto-archive** the moment they're entered (Keep → archive,
  Complete → archive). They should not linger on the main dashboard.
- **Expand behavior** (the `∨` / `>` on the card): collapsed shows the four slots
  only. Expanded reveals per-item lines (`black jacket … $200`) and secondary
  actions (`more info`, `archive`). More than 5 items → "View all" opens a full
  detail page (mirror the Amazon overflow rule — see Part 4).

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

**Divergences to confirm before build:**
- ⚠️ **Delivered/returnable shows displayStatus `shipped`.** displayStatus has no
  "delivered" rung, so a delivered order still in its return window reads "Shipped."
  This is the AquaTru "Shipped forever" bug. Slot 3 must NOT read displayStatus alone
  here — use `deliveredAt !== null` (O7) and/or internal `status`.
- ⚠️ **`kept` has no internal `Order.status` value** — it exists only as displayStatus
  `kept` (+ `keptAt`). Confirm intended, or add a status value.
- **Name drift across columns** (awaiting_refund / refund_pending / returned for one
  state; refunded / completed / refunded for another). Not necessarily wrong, but the
  state machine must state which name it reads/writes at each step so the three fields
  never drift apart at runtime.

---

## Part 3 — The Needs-review bucket

This is a **container**, structurally identical to the Amazon bundle — NOT a single
card. It holds N flagged orders. Reuse the bundle component/pattern; do not design a
new one.

**Bucket header** (its own 2x2):

- Slot 1: `Needs review`
- Slot 2: count (`3 items`)
- Slot 3: the attention treatment (orange)
- Slot 4: expand / collapse

**Each row inside** (its own 2x2):

- Slot 1: retailer
- Slot 2: date · amount (e.g. `7/16 · $200`)
- Slot 3: **why** — free text, open-ended (`possible duplicate`, `no return policy`)
- Slot 4: **action** — from the closed set below

**Collapsed vs expanded:**

- Collapsed = compact stack of rows showing slots 1–3 only (identity + why, no
  buttons).
- Expanded = each row reveals its slot-4 action.

**Slot 3 (why) is open-ended. Slot 4 (action) is a closed set of four:**

| Canonical action | UI copy (from mockup) | Effect |
|---|---|---|
| Link to order | "Merge with existing order" | attaches the email to an existing order |
| Not a purchase | "Archive" / junk | junk-with-rescue (reversible), not hard delete |
| View detail | "More info" | opens the item's detail |
| Nothing | (leave in bucket) | stays flagged, no-op |

- Any **reason with no registered action degrades to "View detail"** — never throws.
  This is what lets the bucket ship before every possible reason is mapped.
- Populations that feed this bucket (from the four-slot inventory): orphaned
  genuine-commerce emails, linked-but-flagged emails, duplicates, extraction
  failures. Each just needs a slot-3 reason string and a slot-4 action; unknown →
  View detail.

**Overflow:** the bucket can hold 3 today and 15 after a bad extraction week. Show
up to N rows inline, then `View all {N} →` to a dedicated page. **Reuse the Amazon
bundle's threshold — do not invent a second number** (see Part 5, decision 2).

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

## Part 5 — Open decisions for owner (answer these to unblock the build)

Write answers inline. This is the only creative work required to move the whole spec.

1. **Bucket name.** "Needs review" or "Needs attention"? (Mockups use both. Pick one,
   use everywhere.)
   → ANSWER:

2. **Overflow threshold.** Confirm the Needs-review bucket and expanded order cards
   both reuse the Amazon bundle's inline limit (believed to be 5) before "View all".
   → ANSWER:

3. **Keep before delivery.** The "Awaiting delivery" state offers a single Keep
   action that archives immediately. Correct? Or should pre-delivery orders have no
   action until delivered?
   → ANSWER:

4. **Slot-4 copy, order cards.** Confirm the action labels: `Keep`, `Start Return`,
   `Dropped it off?`, `Refund received?`. Any wording changes?
   → ANSWER:

5. **Slot-3 chip copy.** Confirm the state chips: `Arrives {date}`, `{n} days left`,
   `Return requested`, `Returned {date}`, `Kept`, `Refunded`. Any changes?
   → ANSWER:

6. **"View detail" vs "More info".** Is this a row expansion in place, or navigation
   to a separate order-detail page?
   → ANSWER:

7. **Overflow menu (mobile #3).** Confirm: replace the "⋯" menu with a visible trash
   icon (own confirm) + an always-visible Archive control. Yes/no?
   → ANSWER:

8. **Kept / Complete auto-archive.** Confirm both terminal states archive
   immediately with no user step. (Note: a separate bug exists where unarchiving a
   kept order re-surfaces a countdown — the state machine prevents the *card* bug,
   but decide whether Unarchive should warn.)
   → ANSWER:

9. **Needs-review action set.** Confirm the four closed actions (Link to order / Not
   a purchase / View detail / Nothing) and that "Not a purchase" uses junk-with-
   rescue, never hard delete.
   → ANSWER:

---

## Part 6 — What this replaces

When this spec is approved and built, close these items (they're all facets of it):

- Needs Review panel UI
- Mobile audit #3 (overflow menu) — folded into slot 4 / decision 7
- Mobile audit #4 (state-label contradictions + button hierarchy) — solved
  structurally by the single state machine driving slots 3 + 4
- Mobile audit #5 (quick-check / review disclosure surface) — the Needs-review bucket
- M2 return-portal — UI half (the "unverified portal" reason is just another slot-3
  reason string in the bucket)
- Task 3 four-slot inventory — the populations map to bucket rows

Not covered here (stay separate): Amazon extraction template bug; the
`returnDeadline < orderDate` root cause; the orphaned-email matcher (feeds the bucket
but is its own backend work).

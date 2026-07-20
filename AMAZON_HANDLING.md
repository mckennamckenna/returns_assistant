# Amazon Handling — Design Spec

> **Status: DRAFT for owner review.** Design questions O1–O3 resolved
> (2026-07-20); O4–O5 are decide-during-build. Once approved, this is the
> reference `amazon-dashboard-folder-view` (UX) and
> `amazon-per-email-reminder-cadence` (reminders) build against — no more
> piecemeal Amazon patches ahead of it (2026-07-19 decision).
>
> **The collapsed- and expanded-card mocks are the source of truth for the UX.**
> Where prose and mock disagree, the mock wins — flag it, don't reconcile silently.
>
> Internal status enum spellings below are inferred from the task board —
> **verify against `prisma/schema.prisma` before coding.**
>
> Sources: TASKS.md Amazon items + Decisions log (2026-07-19, 2026-07-20); owner
> mocks — expanded and collapsed Amazon card (2026-07-20); owner notes 2026-07-20.

> **⚠ Strategic caveat (owner, 2026-07-20 — settle before building Part 1.3).**
> Owner doubts users will actually *action* Amazon returns inside Return Window —
> Amazon's own return flow is frictionless, so the app's Amazon value is likely
> **awareness** (what's in flight, money in play, earliest deadline), not driving
> keep/return. If that holds: the **collapsed / awareness layer (Part 1.1–1.2 +
> "Go to Amazon") stands as-is**, but the **per-order action model (Part 1.3's
> Keep/Return buttons, the Awaiting-Drop-off / Awaiting-Refund states, the
> active-order priority) is over-built** and the expanded card collapses toward a
> read-only order list plus the escape hatch. **Do not build Part 1.3's action
> machinery until this is settled.** Note this *simplifies* the work — several
> open items (O4 cadence, the returnable-vs-refund priority) partly dissolve if
> Amazon is awareness-only.

---

## 0. Source docs Claude Code must read first

This spec references contracts defined elsewhere rather than restating all of
them. Before building, read:

- **`return-window-design-tokens.md §2`** — the 2×2 card geometry (top-left
  retailer, bottom-left price, top-right timeline, bottom-right cell). Amazon
  shares this grid so it aligns on the dashboard; it does **not** inherit the
  standard card's "action in bottom-right" rule (Part 1).

  > **⚠ Verification note (Claude Code, 2026-07-20):** checked
  > `return-window-design-tokens.md` — §2 is "Type scale" (font sizes), not
  > card geometry, and no section in that file describes a 2×2 grid. The only
  > card-anatomy content present (§6, "Commit 2: Dashboard layout redesign")
  > describes a **left-to-right single-column layout** — logo circle → middle
  > column (retailer/order-number/status pill) → top-right days-left pill →
  > price + return-by below → two buttons — not a 2×2 grid. TASKS.md's own
  > Decisions log (2026-07-20, "Collapsed-card contract resolved") already
  > cites this same §2 reference, so this mismatch predates this doc — it
  > isn't something this spec introduced. The 2×2 contract may exist only in
  > the mock images, never transcribed into `return-window-design-tokens.md`.
  > Per this doc's own rule: flagging, not guessing. **Before coding Part 1,
  > confirm where the 2×2 geometry is actually written down** (update
  > `return-window-design-tokens.md`, or point this citation at the mock
  > directly) so the reference is accurate.

- **`REFUND_VERIFICATION_LOOP_PLAN.md`** — the refund confirmed/disputed branch
  off "Awaiting Refund" (Part 2). The mock omits this branch; the plan is authoritative.
- **`prisma/schema.prisma`** — the real `status`/`displayStatus` enum spellings.
  The Part 2 mapping table uses inferred names; verify before coding.
- **`BUILD.md`** — order-linking notes, the auto-archive-on-kept/refunded
  invariant, `computeDeadline()`'s anchor rule.
- **`SECURITY_AUDIT.md` (M2)** + `classifyReturnPortalTrust()` — portal trust
  tiers, for the Amazon-hosted-portal question (O5).

If a reference is unclear, the source doc wins — flag the conflict, don't guess.

---

## Why Amazon is a first-class case, not another patch

Every session so far has bolted on an Amazon-specific adaptation: no
`order_confirmation` email type, no purchase date in the email, sub-brand format
variance, category-dependent return policies, refund emails with no dollar
amount, Amazon-hosted return portals, and an order-date-vs-delivery-date anchor
mismatch. This spec writes Amazon down once so the next thing built is an
instance of a considered design, not the Nth special-case.

The document is split into three layers so it stays maintainable as extraction
improves: **Part 1 — user experience**, **Part 2 — dashboard / state rules**,
**Part 3 — current parser limitations.**

---

# Part 1 — User experience (the Amazon card)

Amazon is intentionally different from a standard retailer card. It is a
**folder**, and **expanding it is the primary interaction.** The collapsed card
does not carry Keep/Return — that is the deliberate exception to the dashboard's
normal "collapsed cards expose an action" rule.

## 1.1 Collapsed card (mock is source of truth)

The collapsed Amazon card shows exactly five things, nothing more:

1. **Amazon identity** — logo + "Amazon"
2. **Order count** — "7 orders"
3. **Bundle composition** — "4 delivered · 2 in transit · 1 ordered"
4. **Earliest actionable deadline** — the right-side badge (see 1.2)
5. **Expand affordance** — chevron

It sits in the shared 2×2 grid (`return-window-design-tokens.md §2`) so it aligns
with other cards, but its **bottom-right cell is a summary (the deadline badge),
never an action.** This balance is deliberate — enough to be useful, not so much
that Amazon dominates the dashboard.

**Implied state — no explicit state label.** The right-side badge alone
communicates state, and its value depends on the bundle's most-urgent active
order:

- `12 days` → a returnable order with the clock running
- `Delivered Jun 18` → delivered, decision pending
- `Returned Jun 22` → return in progress

Adding a separate state word on top of this would just add noise. *(This decision
does not retire mobile-audit finding #4 — that bug is labels contradicting each
other, a separate coherence problem. See that item.)*

## 1.2 The earliest-deadline badge

The badge value is **the earliest actionable return deadline among the bundle's
active child orders** — explicitly **not** every order in the bundle. "Active"
here = children that still have a return clock the user must act against
(returnable; and awaiting-drop-off if its label/QR can expire). Orders awaiting
refund contribute no deadline (nothing left to act on), and not-yet-delivered and
completed/archived children are excluded entirely.

## 1.3 Expanded card

Expanding reveals up to **five child rows**, plus footer actions.

**Each row is one Amazon ORDER, not an item.** This is load-bearing: the item
description (e.g. "7/1 black jacket and 3 other items") exists only so the user
recognizes which order it is. The buttons operate on the **entire order.** Do not
evolve this into item-level returns — that is an explicit non-goal.

Row layout: `[order date] · [item description, for recognition] · [price] ·
[state-dependent right cell]`. Right cell by state:

- **delivered / returnable →** `Keep` and `Return` as **two distinct buttons**
  (S3 acceptance criterion — not a single combined control).
- **not yet delivered →** status text only ("arrives 7/29"), no action.

**Which five rows appear — most relevant ACTIVE orders, not the newest five.**
Priority order:

1. Awaiting drop-off
2. Awaiting refund
3. Returnable
4. Awaiting delivery

Completed / archived orders never appear inline — they live on the full Amazon
page.

**Footer actions:**

- **"View all N orders"** — e.g. "View all 7 orders." Explicit destination that
  scales; replaces the vague "more info."
- **"Go to Amazon"** — an escape hatch back to Amazon regardless of platform. Not
  "Go to Amazon App."

---

# Part 2 — Dashboard / state rules

## 2.1 Bundle model

One folder-style card groups all strict-Amazon children (net-new grouping — field
or derived). It sorts among the other retailer cards by its earliest active child
deadline, like any other card.

## 2.2 Deadline aggregation

The bundle's deadline (which drives both the collapsed badge in 1.2 and the card's
sort position) is the **earliest actionable deadline among active children** —
returnable and in-progress. Not-yet-delivered children have no return clock and
are excluded; completed/archived are excluded; awaiting-refund children contribute
no deadline.

## 2.3 Order state model — map to EXISTING statuses, don't invent

The mock's friendly labels map onto the app's existing internal statuses. **Do not
create parallel states.** (Verify spellings against the schema.)

| Mock label (user-facing) | Internal status | Notes |
|---|---|---|
| Awaiting Delivery | `ordered` / `shipped` | excluded from deadline aggregation |
| Returnable | `returnable` | countdown badge; decision pending |
| Awaiting Drop-off | `return_requested` | return started; drop-off/label deadline if any |
| Awaiting Refund | `returned` | `returnedAt` set; refund check-in chain active; no return deadline |
| Kept | `kept` | **auto-archives immediately** (existing invariant) |
| Complete | `refunded` | **auto-archives immediately** (existing invariant) |

> **⚠ Verification note (Claude Code, 2026-07-20):** checked
> `prisma/schema.prisma` — this table conflates two separate fields under one
> "Internal status" column. The schema actually has:
> - `status` (internal state machine): `"ordered" | "shipped" | "delivered" |
>   "returnable" | "return_started" | "refund_pending" | "completed" |
>   "expired" | "needs_review"`
> - `displayStatus` (user-facing): `"ordered" | "shipped" | "return_requested" |
>   "returned" | "refunded" | "kept"`
>
> `Returnable` maps to a `status` value; `Awaiting Refund`/`Kept`/`Complete` map
> to `displayStatus` values — so the table is right to use different fields per
> row, but doesn't say which field gates which row, and there's a real spelling
> conflict: **`Awaiting Drop-off` is written here as `return_requested`
> (the `displayStatus` spelling), but the analogous `status` value is
> `return_started`** — not the same string. Which field actually determines
> the "Awaiting Drop-off" row's presence/priority (1.3) and the drop-off-label
> deadline (1.2) needs to be pinned down before coding — flagging per this
> doc's own rule rather than guessing which one is intended.

Two reconciliations:

- **Keep and Complete "send immediately to archive"** — this is the existing
  auto-archive-on-`kept`/`refunded` behavior. No new archive mechanism.
- **Awaiting Refund is NOT a straight line to Complete.** The refund-verification
  loop (`REFUND_VERIFICATION_LOOP_PLAN.md`) adds the branch the mock omits: refund
  confirmed → Complete/archive; refund **disputed** (`refundDisputedAt`, via the
  Yes/No check-in) → stays open/disputed, up to 3 follow-ups. Keep this branch.

## 2.4 Scope — what counts as an Amazon order

**Strict `isAmazonOrder` only** (2026-07-20). Adjacent brands are not folded in and
render as their own standard cards — **Zappos and Shopbop are their own entities**,
as is any other Amazon-adjacent retailer. The folder exists to stay out of the
way, not to be clever about brand-family membership. Grocery and health-adjacent
commerce are blocked upstream and never reach this logic (Part 3 + non-goals).

*Remaining work is implementation, not design:* CC identifies the actual
sender-domain signal that means "this is Amazon" from real inbound data.

---

# Part 3 — Current parser limitations

These are constraints the UX must tolerate **today**, framed as limitations that
will ease as extraction matures — not permanent truths. Kept separate from Parts
1–2 so improving the parser doesn't require touching the UX spec.

- **No `order_confirmation` email type** — Amazon doesn't send one in the standard
  shape (Bug 8).
- **No purchase date →** `orderDate` falls back to `receivedAt`
  (`applyFallbackOrderDate`); `deadlineIsEstimated` stays `true`.
- **Sub-brand format variance:** Fresh, Prime Video, marketplace 3P, digital —
  different templates. (Whole Foods is Amazon-family but out of scope — see
  non-goals.)
- **Category-dependent return windows** (window varies by product category).
- **Refund emails often omit a dollar amount →** auto-advance to `returned` only
  (never `refunded`) when no confirmed amount; a confirmed amount → `refunded`
  (Bugs 9+10+11 decision).
- **Amazon-hosted return portals** — `returnPortalUrl` points at Amazon itself,
  not a retailer "start return" link (see O5).
- **Anchor mismatch** (order-date vs delivery-date) — anchor selection must obey
  the existing `computeDeadline()` rule (order-date when unconfirmed; a wrong
  deadline is worse than a missing one).

> Per "Watching: Amazon extraction quality," **do not build dedicated
> Amazon-specific parsing yet** — wait for 10+ real users to justify it. This
> section records the limitations; it is not a mandate to special-case the parser.

---

## Reminders / email cadence (`amazon-per-email-reminder-cadence`) — future, gated

**Problem:** Amazon is high-volume and multi-item, linking is fragile, and partial
shipments + refunds are common — so a user may need to know about each individual
email, not just the deadline. Today the pipeline treats Amazon like any retailer
(deadline-threshold 7/2/1/same-day, no per-email touchpoint).

**Email-first bar:** any per-email Amazon touchpoint must still earn its place. A
reminder for every shipment email is noise — the opposite of "the right reminder
at the right moment."

Gated: build after this spec and the folder card; reminders likely last.

---

## Open questions (remaining)

- **O1 — Scope: RESOLVED 2026-07-20** — Amazon-only; adjacency renders as its own
  card. Sender-signal identification is implementation. (2.4)
- **O2 — Implied state: RESOLVED 2026-07-20** — no explicit label; badge carries
  it. Does not close finding #4. (1.1)
- **O3 — Grocery / Whole Foods / health: RESOLVED 2026-07-20** — deliberately
  blocked upstream; not an Amazon-bundle concern. (non-goals)
- **O4 — Per-email reminder trigger** (open, build-time): which Amazon emails
  warrant a touchpoint, and via a retailer-policy-DB cadence flag or an
  Amazon-specific branch in `lib/reminders.ts`.
- **O5 — Portal trust tier** (open, build-time): treat Amazon-hosted
  `returnPortalUrl` as retailer-own-domain, or its own tier? Reconcile with M2's
  `classifyReturnPortalTrust()`.

---

## Non-goals

- **Item-level returns** — rows are orders; actions operate on whole orders. Do
  not evolve into per-item returns (Part 1.3).
- **Brand-family cleverness** (folding in Zappos / Shopbop / Whole Foods /
  marketplace) — rejected; adjacency renders as its own card (2.4).
- **Grocery and health/pharmacy-adjacent commerce (incl. OTC) — deliberately
  blocked, not processed.** Excluding the OTC Flonase order was the **correct,
  intended outcome** (owner-confirmed 2026-07-20) — Return Window does not process
  grocery or health-adjacent commerce. This is a **policy decision, not a
  classifier bug**; update `isCommerceEmail()`'s comments so a future session
  doesn't "fix" it back. The one live caution is *precision*: define the exclusion
  on a reliable signal so it catches grocery/health without also dropping
  returnable general retail the product does want — and do NOT block by
  product-name keywords alone. Whole Foods specifically: we don't yet know how
  those emails arrive, so wait for a real sample before finalizing the signal.
  Track with the grocery + pharmacy items, now resolved toward deliberate
  exclusion.
- **Auto-detecting refunds** from a follow-up email as a replacement for the
  manual button — out per owner (mobile finding #7).
- **Amazon-specific extraction parsing now** — deferred to real usage data
  (Part 3).

# Amazon Handling — Design Spec (v1: awareness-only)

> **Status: DRAFT for owner review.**
>
> **v1 scope decision (2026-07-20): awareness-only.** The Amazon card *lists*
> orders so the user can see what's in flight — it does **not** drive keep/return
> in-app. Rationale: users handle Amazon returns in Amazon's own (frictionless)
> flow; Return Window's Amazon value is visibility, not action. The action model
> (keep/return buttons, return state machine, per-email reminder cadence) is
> **deferred to a possible v2**, preserved at the end of this doc.
>
> **Build-ready once O6 is pinned** (the card layout, transcribed from the mock —
> minor). O7 reduces to "read `displayStatus` for the row's status label — verify."
>
> Sources: TASKS.md Amazon items + Decisions log (2026-07-19/20); owner mocks
> (collapsed + expanded Amazon card, 2026-07-20); owner notes 2026-07-20.

---

## 0. Source of truth + docs to read first

- **Card geometry: the MOCK IMAGES are the source of truth.** Do not rely on
  `return-window-design-tokens.md` for it — that doc's §2 is "Type scale," and its
  §6 describes a single-column left-to-right layout that may not match the mock.
  Build the card from the mock; transcribe the final layout into the tokens doc
  (O6).
- **`prisma/schema.prisma`** — the real `status` / `displayStatus` enum values.
  v1 only *reads* state for a label, so `displayStatus` is almost certainly the
  field to use — verify (O7).

  > **⚠ Verification note (Claude Code, 2026-07-20):** checked. `displayStatus`
  > alone is **not** sufficient for the row label as specced. `DISPLAY_STATUS_LABELS`
  > (`lib/displayStatus.ts`) only covers `ordered | shipped | return_requested |
  > returned | refunded | kept` — and per `deriveDisplayStatus()`'s ladder, both
  > "in transit" and "delivered, decision pending" collapse to the **same**
  > `displayStatus` value (`"shipped"`, since both `shipping_confirmation` and
  > `delivery` emails derive to `"shipped"`). `displayStatus` can't by itself
  > distinguish 1.2's `arrives 7/29` row from its `12 days` (returnable countdown)
  > row — both would read `"shipped"`. The word "Returnable" doesn't appear
  > anywhere in the current UI at all; it only exists as an internal `status`
  > enum value (`lib/linkOrder.ts`, `lib/alerts.ts`), a separate field from
  > `displayStatus`. The actual distinguishing signal today is more likely some
  > combination of `deliveredAt` / `estimatedDeliveryDate` (both real columns,
  > confirmed in `lib/linkOrder.ts`) plus internal `status`, not `displayStatus`
  > alone. **O7 is not yet actually resolved** — still needs pinning down which
  > field(s) drive each of the four row-label states before coding 1.2.
- **`BUILD.md`** — order-linking + `computeDeadline()`'s anchor rule (for the
  deadline badge).

If a reference is unclear, the source (mock or schema) wins — flag it, don't guess.

---

## Why Amazon still needs its own handling (even as a list)

Amazon orders fan out into many shipments and several "orders" that are really one
shopping session, so a card-per-order treatment makes the dashboard chaotic — a
folder card fixes that. Amazon also carries extraction quirks (no order date, no
`order_confirmation` type, variable sub-brand formats) that affect what a row can
even display; those are catalogued in Part 3 so the list degrades gracefully.

---

# Part 1 — The Amazon card (UX)

Amazon is a **folder**. It's the deliberate exception to the dashboard's normal
"collapsed cards expose an action" rule: the collapsed Amazon card carries **no
action**, and **expanding it is the primary interaction.**

## 1.1 Collapsed card (mock is source of truth)

Shows exactly five things:

1. **Amazon identity** — logo + "Amazon"
2. **Order count** — "7 orders"
3. **Bundle composition** — "4 delivered · 2 in transit · 1 ordered"
4. **Earliest actionable deadline** — the right-side badge (see 1.3)
5. **Expand affordance** — chevron

**Implied state, no explicit label:** the badge alone signals state, its value
depending on the most-urgent active order — `12 days` (returnable), `Delivered
Jun 18` (delivered), `Returned Jun 22` (return in progress). A separate state word
would just add noise. *(Does not close mobile-audit finding #4 — separate issue.)*

## 1.2 Expanded card — a read-only list of orders

Expanding reveals up to **five order rows**, **read-only** (no keep/return in v1).

- **Each row is one Amazon ORDER.** Row: `[order date] · [item description, for
  recognition] · [price] · [status label]`. The item description exists only so
  the user recognizes the order.
- **Status label** is the order's current state, shown as the right-side value
  ("arrives 7/29", "Delivered Jun 18", "12 days", "Returned Jun 22"). Read from
  `displayStatus` (verify — O7; see verification note above, not yet resolved).
- **Which five show:** soonest actionable deadline first, so the most
  time-relevant order is on top; the rest live on the full page. (Simple default —
  easily changed later.)

**Footer:**
- **"View all N orders"** — e.g. "View all 7 orders" — opens the full read-only
  Amazon page (same row format, all orders).
- **"Go to Amazon"** — escape hatch back to Amazon, any platform. (Not "Go to
  Amazon App.")

## 1.3 The earliest-deadline badge

The badge = **the earliest actionable return deadline among the bundle's active
children** — not every order. "Active" = children with a live return clock
(returnable; drop-off if a label can expire). Awaiting-refund children contribute
no deadline; not-yet-delivered and completed/archived are excluded.

---

# Part 2 — Dashboard / bundle rules

## 2.1 Grouping

One folder card groups all strict-Amazon orders (net-new grouping — field or
derived). It sorts among the other retailer cards by its earliest active child
deadline, like any card.

## 2.2 Deadline aggregation

The bundle deadline (drives the 1.3 badge and the card's sort position) = earliest
actionable deadline among active children. Not-yet-delivered have no return clock;
completed/archived excluded; awaiting-refund contributes no deadline.

## 2.3 Scope — what counts as an Amazon order

**Strict `isAmazonOrder` only** (2026-07-20). Adjacency renders as its own card —
**Zappos and Shopbop are their own entities.** Grocery and health-adjacent
commerce are blocked upstream and never reach this logic (see non-goals).
*Remaining work is implementation:* CC identifies the real Amazon sender signal
from inbound data.

---

# Part 3 — Current parser limitations

Constraints the list must tolerate **today**, framed as limitations that ease as
extraction matures — kept separate so improving the parser doesn't touch the UX:

- **No `order_confirmation` email type** (Bug 8).
- **No purchase date →** `orderDate` falls back to `receivedAt`
  (`applyFallbackOrderDate`); `deadlineIsEstimated` stays `true`.
- **Sub-brand format variance:** Fresh, Prime Video, marketplace 3P, digital.
  (Whole Foods is Amazon-family but out of scope — see non-goals.)
- **Category-dependent return windows.**
- **Refund emails often omit a dollar amount →** `returned` only (not `refunded`)
  until an amount is confirmed (Bugs 9+10+11).
- **Amazon-hosted return portals** — `returnPortalUrl` points at Amazon itself.
- **Anchor mismatch** (order-date vs delivery-date) — must obey `computeDeadline()`
  (order-date when unconfirmed; a wrong deadline is worse than a missing one).
- **Item data is category counts, not product names** (real order emails,
  2026-07-20) — e.g. "2 items: 1 Essentials, 1 Electronics." No real product
  names or photos available at extraction time. Any UI row showing an "item
  description" is really showing a category summary at best; copy should not
  imply a specific product name.
- **Delivery dates are relative, not absolute** (real order emails,
  2026-07-20) — e.g. "Arriving tomorrow" / "Arriving Wednesday." Must be
  resolved to an absolute date against the email's `receivedAt` at extraction
  time, not displayed or stored as the relative phrase.
- **One order number can span multiple shipments within a single email**
  (real order emails, 2026-07-20) — observed `111-7078168-2781034` listed
  as both "Arriving Wednesday" and "Arriving tomorrow" in the same email.
  Split-shipment dedup risk: this must not be extracted/rendered as two
  separate orders.

> Don't build Amazon-specific parsing until 10+ real users justify it ("Watching:
> Amazon extraction quality"). This section records limitations, not a mandate.

---

## Open questions

- **O1–O3: RESOLVED 2026-07-20** — Amazon-only scope; implied state (no label);
  grocery/health blocked upstream.
- **O6 — Card layout** (minor, needed for Part 1): transcribe the real card
  geometry from the mock into `return-window-design-tokens.md` (its §2 is type
  scale; §6 is a single-column layout that may not match). Build from the mock.
- **O7 — Which field for the row label** (minor, needed for Part 1.2): confirm
  `displayStatus` is the field read for the status label. Pin the enum values
  against the schema. **Checked 2026-07-20 — not resolved, see verification note
  in §0.** `displayStatus` alone can't distinguish the four row states as
  specced; needs `deliveredAt`/`estimatedDeliveryDate` and/or internal `status`
  in the mix. Needs an actual decision before 1.2 is coded.

*(O4 per-email cadence and O5 portal-trust tiering are deferred with the v2 action
model / general extraction work — not part of v1.)*

---

## Non-goals (v1)

- **In-app keep/return for Amazon** — deferred to v2 (see below).
- **Item-level anything** — rows are orders, never items.
- **Brand-family folding** (Zappos / Shopbop / Whole Foods / marketplace) —
  rejected; adjacency is its own card.
- **Grocery + health/pharmacy-adjacent (incl. OTC) — deliberately blocked, not
  processed.** Excluding the OTC Flonase order was the **correct, intended
  outcome** (owner-confirmed) — a policy decision, not a classifier bug; update
  `isCommerceEmail()`'s comments so a future session doesn't "fix" it back.
  Caution: define the exclusion on a reliable signal (not product-name keywords)
  so it doesn't drop returnable general retail; wait for a real Whole Foods sample
  before finalizing the grocery signal. Track with the grocery + pharmacy items.
- **Amazon-specific parser work now** — deferred to real usage data (Part 3).

---

## Deferred to a possible v2 (not building now)

Preserved so the option isn't lost. Revisit only if usage shows people want to act
on Amazon inside Return Window rather than in Amazon's own flow:

- **In-app actions** — per-order Keep / Return as two distinct buttons on delivered
  rows; the return state machine (Awaiting Delivery → Returnable → Awaiting
  Drop-off → Awaiting Refund → Complete), with Keep/Complete auto-archiving and the
  refund confirmed/disputed branch (`REFUND_VERIFICATION_LOOP_PLAN.md`).
- **Active-order priority** for the visible five (drop-off → refund → returnable →
  delivery), which only matters once rows carry actions.
- **Amazon per-email reminder cadence** (`amazon-per-email-reminder-cadence`, O4).
- Reopening O5 (Amazon-hosted portal trust tier) if actions surface those links.

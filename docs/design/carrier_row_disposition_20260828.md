# Carrier-row disposition — design doc (held, not committed)

Scoping session, 2026-08-28. No code changes, no DB writes. Working through
design questions one at a time; each is confirmed with the owner before
moving to the next. This file accumulates the running record.

## Phase 0 — Context: existing orphan-email → order linking flow

**Component:** `app/LinkToOrderPicker.tsx:20` (`LinkToOrderPicker`). Renders
a "Merge with existing order" button opening a dropdown of the user's
orders (retailer, order number, order date). Deliberately dumb per its own
comment (lines 15-19): no search, no auto-suggestion, shows the full list.

**Only call site today:** `app/NeedsReviewRow.tsx:86`, rendered when
`action.id === "link_to_order" && row.kind === "email"` — i.e. an orphaned
email (`Email.orderId === null`) that `detectEmailReviewReason`
(`lib/needsReviewRows.ts`) classified as `belongs_to_existing_order`,
`duplicate`, or `return_or_refund_no_link`. Order-kind rows never get this
picker (order-to-order merge is unimplemented).

**Narrowing signal:** none inside the picker itself — it's fed the full
list as-is. The list is narrowed upstream at the query level:
`app/(app)/page.tsx:112-117` and `app/(app)/needs-review/page.tsx:38-42`
build it via `prisma.order.findMany({ where: { userId, archivedAt: null,
deletedAt: null } })` — current user's non-archived, non-deleted orders
only. No date-range or retailer narrowing.

**Write path:** picker → `linkEmailToOrderAction(emailId, orderId)`
(`app/actions.ts:39-48`, server action) → ownership checks →
`linkEmailToExistingOrder` (`lib/orderReview.ts:77-88`) → `mergeEmailIntoOrder`
→ `prisma.email.update({ data: { orderId, needsReview: false } })` →
`applyFallbackOrderDate` / `recomputeOrderStatus` / `recomputeDisplayStatus`
→ `revalidatePath("/")`.

**No API route writes `Email.orderId`** — the server action is the sole
write path. This is the pattern Phase 3/4 below should reuse, not
reinvent.

**Verification pass (2026-08-28, owner-requested re-check):** confirmed
`LinkToOrderPicker` is the only manual "link an orphaned email to an
*existing* order" flow, and its call site is the only one, per an
exhaustive second search of `app/`, `app/admin/**`, and every
`lib/orderReview.ts`/`lib/linkOrder.ts` export that writes
`Email.orderId`. Two adjacent things exist and are worth naming so
"only flow" isn't overstated:
- `lib/orderReview.ts`'s `createOrderFromOrphanedEmail` (also reachable
  from `app/actions.ts:57`, the needs-review "Start a new order" button)
  writes `orderId` too, but it *creates* a new order from an orphan —
  not linking to an existing one, so it's a different action, not a
  second instance of the same flow.
- `lib/orderReview.ts`'s `splitOrder` (line 54), invoked from
  `app/admin/actions.ts:24`'s `adminSplitAction`, admin-only
  (`ADMIN_SECRET`-gated), does directly mutate `Email.orderId` — it
  moves an already-linked order's most-recently-received email off into
  a brand-new order. Not an orphan-linking flow (the email isn't
  orphaned going in), and not user-facing, but it is a second code path
  that changes which order an email belongs to, outside
  `LinkToOrderPicker`/`linkEmailToOrderAction` entirely. Not touched or
  generalized to by anything in this design — noted for completeness,
  not because Phase 3 needs to account for it.
- `lib/linkOrder.ts`'s `linkEmailToOrder` (~line 1024) also writes
  `orderId`, but it's the automated inbound-matching pipeline run at
  ingestion time, not a manual UI flow — not a second instance of
  `LinkToOrderPicker`'s pattern either.

**Generalization verdict:** there is exactly one existing manual
orphan-email-to-existing-order UI flow, and Phase 3 slots into it by
adding a new routing branch (Q4a) rather than building a second flow or
generalizing across multiple ones — there's only ever been the one to
generalize to.

**Bonus finding relevant to Phase 2 (tracking extraction):** tracking
extraction already exists, but only for *linked* orders. `lib/linkOrder.ts`
(`applyShippingTracking`/`applyReturnTracking`, called at lines 1027-1028)
runs `parseTracking()` (`lib/trackingParser.ts`, regex-based: UPS/USPS/
FedEx/DHL number + URL patterns) against `shipping_confirmation`/
`return_label` emails **once they're attached to an order** — first-match-
wins, single field on `Order` (`trackingNumber`/`carrier`/`trackingUrl`,
mirrored for returns). It never runs on orphaned carrier emails, because
those have no `orderId` yet and the function requires one. This directly
shapes Phase 2/3/5 below — flagged here, not proposed yet (Phase 2 is its
own gated question later).

---

## Phase 1 — Carrier-name display

**Current call sites reading `retailer` for orphaned carrier emails**
(`Email.retailer` is null for these rows, `retailerSource ===
'carrier_deferred'`):

| Site | Line | Renders |
|---|---|---|
| `lib/needsReviewRows.ts` | 92 | Builds row: `retailer: email.retailer` (null) |
| `app/NeedsReviewRow.tsx` | 69 | `{row.retailer ?? "Unknown retailer"}` — primary card label |
| `app/(app)/emails/[id]/page.tsx` | 99 | Admin/detail field, plain null, no fallback text |
| `app/api/cron/weekly-coverage/route.ts` | 192, 197, 52, 54 | Friday coverage-check digest line: `item.retailer || "an unknown retailer"` |
| `app/api/cron/route.ts` | 352, 361 | Weekly digest reminder/failure summary lines: `?? "Unknown retailer"` |

`retailerSource` is **not read anywhere in UI or digest code today** —
only written at extraction time (`lib/retailerFallback.ts`,
`lib/runExtraction.ts:94-110`) and read in scripts/tests. Every rendering
site above would need a new lookup to show "FedEx" instead of "Unknown
retailer."

### Design question 1: derived-on-read vs. persisted `carrier` column

**Option A — Derived-on-read.** Add a small pure helper (e.g.
`carrierNameFromSource(email): string | null`) that maps
`retailerSource === 'carrier_deferred'` + the email's sender domain to a
display name ("FedEx", "USPS", ...), called at each of the 5 sites above.
No migration, no backfill.

**Option B — Persisted `carrier` column on `Email`.** New nullable column,
written at extraction time (same place `retailerSource` is set today),
read directly at each site.

**Recommendation: Option A.** The mapping is a pure function of two values
already on the row (`retailerSource`, sender domain via `fromEmail`/
`fromName` — both already captured), the call-site count is small (5, all
enumerated above), and it avoids a migration + backfill for what is purely
a display concern. It also composes cleanly with Phase 3: the same helper
can label picker rows or dashboard rows later without a second write path
to keep in sync. Persisting (Option B) would only pay for itself if
carrier needed to be *queried* on (e.g. "show me all FedEx emails" as a
filter) — nothing in Phase 1-5 needs that; carrier identity is always
reached via `retailerSource = 'carrier_deferred'` first, carrier name
second.

Ships fully independently of Phases 2-5 — confirmed, no shared code with
tracking extraction or the picker.

**Owner decision (2026-08-28): persisted column, not derived-on-read.**
Rationale given: simplifies Phase 3/4/5's write-path (Q5) — a real
`Email.carrier` column lets sibling-detection query by carrier +
tracking number instead of re-deriving carrier from sender domain at
query time.

### Finalized Phase 1 plan

**Atomicity (owner requirement):** `carrier` and `retailerSource =
'carrier_deferred'` must be set in the same code path, never one without
the other. Both values are already derived from the same single signal
(sender domain in `CARRIER_DOMAINS`) inside the one shared function both
the runtime path and the backfill script call —
`resolveRetailerFallback()` in `lib/retailerFallback.ts`. Concretely:

1. Add a `CARRIER_DOMAIN_NAMES: Record<string, string>` map next to
   `CARRIER_DOMAINS` in `lib/retailerFallback.ts` (`fedex.com` → `"FedEx"`,
   `usps.com` → `"USPS"`, `ups.com` → `"UPS"`, `dhl.com` → `"DHL"`,
   `ontrac.com` → `"OnTrac"`, `lasership.com` → `"LaserShip"`).
   `RetailerFallbackResult` gains a `carrier: string | null` field; Step 0
   returns `{ retailer: null, retailerSource: "carrier_deferred", carrier:
   CARRIER_DOMAIN_NAMES[registered] }` — same return statement, so there's
   no path where one field is set without the other.
2. `lib/runExtraction.ts:100-102` already destructures `fallback` from
   this same call — add `carrier: fallback.carrier` to the
   `prisma.email.update` write at line 105-124 (currently missing
   `carrier` entirely). One write site, no new one.
3. Migration: new nullable `Email.carrier String?` column. Additive —
   proceeds once shown, per CLAUDE.md's migration rule (no sign-off gate
   beyond that).
4. Backfill script for the 5 existing rows, modeled directly on the
   existing `scripts/backfill-carrier-deferred-20260825.ts` pattern
   (same repo, same gate): dry-run by default, `--apply` to write,
   idempotent via `WHERE carrier IS NULL AND retailerSource =
   'carrier_deferred'`, logs every row id + fromEmail + resolved carrier
   name before writing, re-run-safe (second run finds zero candidates).
5. Read sites: all 5 enumerated above switch from `row.retailer ??
   "Unknown retailer"` to `row.retailer ?? row.carrier ?? "Unknown
   retailer"` (or the order-level equivalent, `order.retailer`, is
   unaffected — carrier only ever applies to orphaned emails).

**Confirmed independent of Phases 2-5** — no shared code, no shared
migration.

**This is ready to become a 🔴 Now build entry on your go-ahead.**
Proceeding to Phase 2 (tracking-number extraction — current state) now,
per the phase order; Phase 1 build entry will be proposed alongside the
others at the end unless you want it split off and started immediately.

---

## Phase 2 — Tracking-number extraction: current state

**Your stated belief going in — not currently extracted — is only half
right. Diagnostic-first check found more already built than expected.**

**What exists today:** `lib/trackingParser.ts` — a regex-based parser
(no AI call, no cost), already carrier-aware (UPS `1Z…`, USPS `9[2-9]…`
22-digit, FedEx 12/15-digit, DHL 10/11-digit), already tested
(`__tests__/trackingParser.test.ts`, 14 cases covering plain-text and
HTML-href detection for all four carriers). It has two detection passes:
(1) scan `href` attributes in raw HTML for a known carrier tracking
domain — most reliable, pulls the number straight out of the URL; (2)
fall back to a plain-text regex scan. Both are already exactly the shape
needed for a carrier email's body.

**Where it's invoked — this is the actual gap:** `applyShippingTracking`
/ `applyReturnTracking` (`lib/linkOrder.ts:393-445`, called at lines
1027-1028) call `parseTracking()` against `shipping_confirmation` /
`return_label` emails, but **only in the code path that runs after an
email is already attached to an `orderId`** (inside
`mergeEmailIntoOrder`/`createOrderFromEmail`'s flow). Result: `stored
queryable` on `Order.trackingNumber` / `Order.carrier` /
`Order.trackingUrl` (shipment) and the mirrored `returnTrackingNumber` /
`returnCarrier` / `returnTrackingUrl` (return) — single field each,
**first-write-wins** (`if (existing?.trackingNumber) return;` — a second
shipping email's tracking info is silently dropped once one is set).

**From carrier emails themselves: never, today.** Carrier emails are
orphans (`orderId: null`) by definition of this whole design pass — they
never reach `applyShippingTracking`/`applyReturnTracking` because those
functions require an `orderId` to write to. The parser is capable
(nothing carrier-specific is missing from it — a FedEx delivery-update
email's body almost certainly matches the same href/regex patterns
already coded), it's simply never called on this population.

**Gap shape: invocation gap, not a capability gap.** Not "genuinely
absent" (no AI extraction needed) and not "behind a track-package link
only" (the parser already handles that case via the href pass). The real
open question for Phase 3/5 is *when* to call `parseTracking()` against
a carrier email's body — at link time (when the user manually links it
to an order via the picker), which requires decrypting and scanning the
body during that request — not whether the capability exists.

**One real gap for multi-package orders (relevant to Q3/Q5 below,
pre-existing, not new):** first-write-wins on `Order.trackingNumber`
means a second box's tracking number is dropped today, for *any* order,
not just carrier-sourced ones. Confirmed via the code, not previously
flagged in TASKS.md/HISTORY.md as its own bug — worth a `TASKS.md` 🐛
entry regardless of what Phase 3/5 decide, since it's a real,
independently-reproducible defect (Wayfair-in-3-boxes shape) unrelated to
carrier rows specifically.

**No proposal yet — per phase order, Phase 2's proposal (Q3) comes next,
gated on this report.**

### Follow-up checks (owner-requested before proceeding to Q3)

**Carrier coverage of the existing regex parser vs. the carrier-domain
tagging list:** `retailerFallback.ts`'s `CARRIER_DOMAINS` (used to tag
`carrier_deferred`) has 6 domains — fedex.com, usps.com, ups.com, dhl.com,
ontrac.com, lasership.com. `trackingParser.ts`'s `CARRIERS` array — the
thing that actually extracts a tracking number/URL — only has patterns
for **4**: UPS, USPS, FedEx, DHL. **OnTrac and LaserShip have zero
detection logic.** A carrier-tagged row from either of those two senders
would resolve `carrier: null, trackingNumber: null` even if invoked.
(Relevant to Q1 too, in isolation this doesn't block Q1 — carrier *name*
display for Phase 1 would still need its own OnTrac/LaserShip mapping,
tracked separately from tracking-number extraction coverage.)

**Real output on the 5 currently-tagged rows** (read-only script,
`scripts/pm-diag-carrier-tracking-parse-20260828.ts`, 0 Anthropic calls —
`parseTracking` is pure regex, decrypt-only):

| emailType | sender domain | carrier resolved | trackingNumber | trackingUrl |
|---|---|---|---|---|
| shipping_confirmation | tracking.usps.com | USPS | **null** | present |
| shipping_confirmation | fedex.com | FedEx | 874801419836 | present |
| shipping_confirmation | fedex.com | FedEx | **874801419836 (same #)** | present |
| delivery | tracking.usps.com | USPS | **null** | present |
| delivery | tracking.usps.com | USPS | **null** | present |

Three findings from real data:

1. **All 5 current rows are USPS or FedEx** — no UPS/DHL/OnTrac/LaserShip
   in the live population yet, so the 2-carrier coverage gap above isn't
   observable today, only latent.
2. **The two FedEx rows share one tracking number** — this is the
   Zara-shaped "one shipment, multiple carrier emails" case from Q6,
   confirmed with real data, not hypothetical.
3. **USPS resolves `carrier` correctly (domain match) but
   `trackingNumber` comes back null on all 3 USPS rows**, despite a
   tracking URL being present. `numberPattern` for USPS expects a
   20-22-digit `9[2-9]…` string *inside the URL itself*
   (`trackingParser.ts:31-34`); these 3 real URLs apparently don't carry
   the number in that shape (fell through to the plain-text pass too,
   also came back null — so the number likely isn't in a regex-matchable
   position in the body at all for these). Not investigated further here
   (would mean reading raw decrypted bodies, out of scope for a scoping
   session) — flagged as a real, observed gap for Q3 to design around:
   carrier *name* is reliably resolvable for the current population,
   tracking *number* is not, for USPS specifically.

**Implication, and owner decision (2026-08-28): Phase 2 is CLOSED, no
build.** The integration uplift to do this cleanly (link-time call site,
field shape, migration, parser validation against carrier-email body
shapes specifically, dedup edge cases) isn't worth it to capture tracking
numbers on 2 of 5 current rows, in service of a Phase 4 feature (sibling
auto-link) that isn't scoped yet. Investigation findings above stand as
the record; no proposal, no code.

## Revised phase plan (owner, 2026-08-28)

- **Phase 1** — carrier-name display, persisted column. Unchanged, as
  designed above.
- **Phase 2** — CLOSED. Investigation complete, findings logged above, no
  build.
- **Phase 3** — full-dropdown manual link. **No tracking-number logic, no
  new `Email.trackingNumber`/similar field, no changes to the extraction
  pipeline.** Simpler than originally scoped.
- **Phase 4** (future, separate design pass, not scoped here) — sibling
  auto-link. Will *begin* with tracking-number extraction as its own
  first scope question, from scratch — not dependent on any Phase 3
  write-path decision made now.

This changes Q5 below: Phase 3's write-path no longer needs to be
designed for Phase 4 tracking-number compatibility, since Phase 4 starts
its own investigation independently. Simplifies to: does Phase 3's link
write-path (reusing the existing `linkEmailToOrderAction` pattern) block
anything Phase 4 might later want to add? Covered under Q5.

Proceeding to Q4 (Phase 3 UI design) next.

---

## Phase 3 — Full-dropdown link UI

### Pre-design finding: carrier rows don't get the link picker today, at all

Traced the routing carrier rows actually get. `detectEmailReviewReason`
(`lib/needsReviewRows.ts:69-82`) is a four-branch tree checked in order:
(1) exact `orderNumber` match, (2) return/refund-side email type, (3)
purchase-side email type **with `retailer` or `orderNumber` present**,
(4) fallback `no_extraction_signal`. Carrier rows have `retailer: null`
and (per the real data above) `orderNumber: null` — they fail branch (3)
on the retailer-or-orderNumber check and fall to branch (4). In
`needsReviewAction` (`lib/needsReviewActions.ts:38-51`),
`no_extraction_signal` isn't one of the three reasons routed to
`link_to_order` — it degrades to `view_detail` ("More info"), same as
the Whole Foods-shaped true-extraction-failure rows this branch also
covers.

**Consequence: `LinkToOrderPicker` never renders for carrier rows today.**
Phase 3 can't just be "point the existing picker at these rows" — it
needs a routing change first: a `no_extraction_signal` row where
`retailerSource === 'carrier_deferred'` needs its own path to
`link_to_order`, distinct from the true-no-signal population (which
should keep degrading to "More info" — those really do have nothing to
go on).

### Design question 4a: how carrier rows get `link_to_order`

**Option A — new reasonId.** Add `carrier_tracking_unlinked` to
`NeedsReviewReasonId`, detected as a new branch in
`detectEmailReviewReason` (checked before the `no_extraction_signal`
fallback, gated on `retailerSource === 'carrier_deferred'`), with its own
copy ("This is a carrier tracking email — link it to the order it belongs
to.") and its own `link_to_order` routing in `needsReviewAction`.

**Option B — widen the existing `real_purchase_no_record` condition** to
also match on `retailerSource === 'carrier_deferred'` (bypassing the
retailer-or-orderNumber check for this case specifically), reusing that
reason's existing copy and routing.

**Recommendation: Option A.** `real_purchase_no_record`'s copy ("This
looks like a real purchase with no order record") is misleading for a
carrier email — the user already has the order record, this is a shipping
notification for it, not an ambiguous purchase. A dedicated reason also
keeps the four-branch tree's existing populations from shifting (Option B
would change what counts as `real_purchase_no_record`, a population
that's already been diagnosed and tuned once — see the `NEEDS_REVIEW_
ROUTING_DESIGN.md` history). Cost is one new reasonId + one new branch,
small and additive, no migration.

### Design question 4b: dashboard row shape, picker scope, order display, unlink, empty state

- **Row shape:** reuse `NeedsReviewRow.tsx`'s existing email-kind card —
  no new row component. Slot 1 (currently `row.retailer ?? "Unknown
  retailer"`) becomes the Phase 1 carrier name ("FedEx"). Existing
  fields (`why` text from the new reasonId, `date` = `receivedAt`,
  `amount`/`currency` — carrier emails have neither, already rendered as
  optional/blank today) carry over unchanged. **Sender/subject aren't
  currently in `NeedsReviewRowData` at all** — if you want those visible
  (your Phase 0 prompt listed them), that's a small additive change to
  the row-data shape, flag if wanted; not assumed here.
- **Picker scope (which orders show in the dropdown):** existing
  `LinkToOrderPicker` call already scopes to the user's non-archived,
  non-deleted orders, no date/retailer narrowing (see Phase 0). Recommend
  reusing this unchanged for carrier rows too — a carrier email could
  belong to any of the user's active orders, no signal to narrow by
  (retailer is exactly what's missing). This matches the only other call
  site's scope already, so nothing carrier-specific needed here.
- **Order display in picker:** already shows retailer + orderNumber +
  orderDate (`app/LinkToOrderPicker.tsx:69`) — no orderTotal today. Add
  orderTotal if useful for disambiguating same-retailer orders; small,
  additive change to `LinkablePickerOrder`'s shape and the query that
  builds it.
- **Unlink/re-link — REQUIRED in Phase 3, not deferrable (owner, 2026-08-28).**
  No existing unlink path anywhere in the app today (checked —
  `linkEmailToOrderAction` only links, nothing calls
  `prisma.email.update({ data: { orderId: null } })`). Owner explicitly
  rejected treating this as optional follow-up: a misclick in the picker
  silently corrupts the linked order's delivery data (wrong tracking/
  return-window state), and recovery today would mean a manual production
  DB write per incident — a real, non-mild failure mode regardless of
  current alpha volume. New small server action mirroring
  `linkEmailToOrderAction`'s pattern (ownership check, single field
  write back to `null`, `revalidatePath`), ships as part of Phase 3, same
  session as the link picker wiring.
- **Subject line on the row: deferred, not required.** Owner's reasoning:
  Phase 1's persisted carrier name already solves the "Unknown retailer"
  problem this was meant to help with; full detail is still one click away
  via the existing card. Sender/subject addition to `NeedsReviewRowData`
  stays a nice-to-have, not scoped into Phase 3.
- **Empty state:** no design needed — if `linkablePickerOrders` is
  empty, `LinkToOrderPicker` already handles this today (existing
  behavior for the one current call site), nothing carrier-specific.

### Design question 5: write-path shape (simplified — Phase 4 no longer a compatibility constraint)

Original Q5 asked for a write-path designed so Phase 4 (sibling
auto-link) could turn on without a schema migration. That constraint is
gone: Phase 4 now begins with its own tracking-number-extraction scope
question from scratch (see revised phase plan above), independent of
whatever Phase 3 writes.

**Proposal:** Phase 3's write-path is exactly the existing pattern, twice
— `linkEmailToOrderAction` (link, already built, reused as-is) and a new
mirror-image `unlinkEmailFromOrderAction` (new, required per above).
Both: session/ownership check → single-field `Email.orderId` write
(`targetOrderId` or `null`) → `revalidatePath("/")`. No new columns, no
new tables, no tracking-number field. This is the same shape every other
`kind: "email"` needs-review row already uses — no carrier-specific
write logic at all, only the routing change from Q4a decides *whether*
the picker shows.

**Does this block Phase 4?** No — Phase 4's own future investigation can
read `Email.orderId` (already set by Phase 3's link) to find "which order
is this carrier email attached to" when it designs sibling-detection;
nothing here needs to anticipate that shape further.

**Owner-flagged, confirmed real (2026-08-28): `Email.orderId` has no
index today.** Checked `prisma/schema.prisma` (`model Email`, no
`@@index([orderId])`) and every migration under `prisma/migrations/`
(`grep`'d for `Email_orderId` — only the FK constraint exists, no `CREATE
INDEX`). Every existing query that filters/joins on `Email.orderId`
(order pages, dashboard, digests, the needs-review candidate-orders
query) is doing an unindexed lookup today — not new with Phase 3, but
Phase 3 adds more write/read traffic through this same column (link,
unlink, and any future re-query). Additive migration (`@@index([orderId])`
on `Email`) — per CLAUDE.md's migration rule, this is safe to add without
a special sign-off gate (new index, no data risk), shown here for the
record before running. Bundling into the Phase 3 build session rather
than a separate one, since it directly serves Phase 3's new write
traffic.

**Future-self note, no change to this design:** the "plain migration,
no special gate" call above assumes today's table size. If `Email` has
grown substantially by the time this actually builds, re-check row count
first — past a certain size, `CREATE INDEX` takes a table lock for the
duration of the build and this becomes a `CREATE INDEX CONCURRENTLY`
question instead (can't run inside a transaction, different migration
mechanics, Prisma doesn't generate it automatically). Not a concern at
current volume; flagging so it isn't silently forgotten if this entry
sits for a while before being built.

### Design question 6: multi-email-per-shipment behavior in Phase 3

Confirmed with real data (Phase 2 section above): the 2 FedEx rows are a
real same-shipment, same-tracking-number pair, currently unlinked
separately. Per your original scope: each carrier email links
independently in Phase 3; a shipment with N carrier emails means N
picker rows, linked one at a time, no auto-detection that two rows are
the same shipment.

**One thing changed by the Phase 2 closure:** the original ask included
"instrument: log when a user links a carrier email whose tracking number
matches an already-linked email — this data seeds Phase 4 design." That
instrumentation needs a tracking number to compare against, which Phase 3
no longer extracts or persists (Phase 2 closed). Doing a throwaway
decrypt+regex at link time *just* for a log line would reintroduce the
exact integration surface Phase 2 was closed to avoid, for logging only.

**Recommendation: drop the instrumentation, accept plain duplication.**
At 5 rows in the DB today, the sibling case is directly countable by
hand whenever Phase 4 investigation starts (query `retailerSource =
'carrier_deferred'`, decrypt, compare — a five-minute one-off then, not
standing instrumentation now). Phase 4's own first scope question
(tracking-number extraction) will need to build real extraction anyway,
at which point real frequency/ambiguity data becomes available for free,
not simulated ahead of time by partial instrumentation now.

**Confirm acceptable:** given today's volume (5 rows), is N independent
picker-links per shipment (no dedup, no warning) acceptable for Phase 3's
expected lifespan before Phase 4 lands?

**Owner sign-off (2026-08-28): confirmed, drop instrumentation, accept
as-is.**

---

## Phase 4 — Sibling auto-link (future, design sketch only)

Per the revised phase plan, Phase 4 is its own future design pass that
starts with tracking-number extraction as its first scope question, not
constrained by anything decided in this session. Shape sketch only, not
scoped:

- Trigger: new carrier email arrives with a tracking number matching an
  already-linked email → auto-link to the same Order.
- Silent auto-link vs. prompt-to-link — left open, Phase 4's call.
- Retroactive backfill pass on existing unlinked carrier emails when
  Phase 4 ships — left open.
- **Prerequisite, stated plainly (owner correction, 2026-08-28):**
  Phase 4 requires tracking-number extraction on carrier emails, which is
  not built today (see Phase 2 above) and will need to be scoped in its
  own future session — Phase 4's design pass starts there, from scratch.
  It **may or may not** end up composing with an eventual, separately
  scoped "return tracking" feature (unscoped, priority-list item only,
  not defined here) — that's an open possibility to consider when Phase
  4 is actually scoped, not a dependency assumed now. Phase 4 is not
  blocked on or tied to return-tracking landing first.

**Confirms Phase 3's write-path (Q5) doesn't block this:** Phase 4 reads
`Email.orderId` (set by Phase 3's link action) as its starting point;
nothing in Phase 3 needs to change for Phase 4 to build on top of it.

## Phase 5 — Candidates-first narrowing (further future)

Deferred per original scope — depends on real Phase 3 link data to
evaluate which signals actually narrow well. Not scoped here.

---

## Proposed `TASKS.md` 🔴 Now entries, dependency order

Design complete pending final sign-off below. If approved, propose
replacing this session's scoping placeholder with:

1. **Phase 1 — carrier-name display.** `lib/retailerFallback.ts`
   (`CARRIER_DOMAIN_NAMES` map, `carrier` field on
   `RetailerFallbackResult`), `lib/runExtraction.ts` (write `carrier` at
   the existing write site), additive migration (`Email.carrier String?`),
   backfill script (`scripts/backfill-carrier-name-<date>.ts`, modeled on
   the existing `backfill-carrier-deferred` script), 5 read sites updated.
   No dependency — can start immediately.
2. **Phase 3 — full-dropdown carrier-row linking.** Depends on Phase 1
   (carrier name for row display). New `carrier_tracking_unlinked`
   reasonId + branch (`lib/needsReviewRows.ts`, `lib/needsReviewReasons.ts`,
   `lib/needsReviewActions.ts`); new `unlinkEmailFromOrderAction` server
   action mirroring the existing link action; wire existing
   `LinkToOrderPicker` unchanged into the new reasonId's row; additive
   `@@index([orderId])` migration on `Email`.

Phase 2 closed (no entry). Phase 4/5 not proposed — future design passes,
not this session's output.

**Doc approved end-to-end, owner sign-off 2026-08-28.** Both Phase 1 and
Phase 3 promote to 🔴 Now together (owner declined to split).

## Appendix: diagnostic script disposition

`scripts/pm-diag-carrier-tracking-parse-20260828.ts` — kept, not deleted.
Same treatment as the existing carrier-digest-suppression diagnostic
(2026-08-26): read-only (decrypt + regex, no writes, no Anthropic calls),
named per the repo's `pm-diag-*` convention, useful paper trail for how
the Phase 2 real-data table above was produced. Not wired into any build
or CI step — a standalone one-off, run manually if this population needs
re-checking later.

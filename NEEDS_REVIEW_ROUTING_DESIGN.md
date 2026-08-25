# Needs-review bucket routing-tree design

Design pass only — not built. Companion to `CARD_SPEC.md` Part 3 (the
Needs-review bucket spec) and the superseding TASKS.md 🟡 Next entry
("Routing tree design for needs-review bucket action selection," which
itself supersedes the 2026-08-21 "default-action heuristic" entry).
Pre-code verification artifact: `scripts/pm-design-needsreview-routing-tree-20260824.ts`
(committed alongside this doc, read-only, 0 writes, 0 Anthropic calls).

Session 1 of 2 (per the TASKS.md entry): enumerate branches + correct
action per branch + required Prisma fields. Session 2 (build) happens only
after owner review of this doc.

---

## 1. Divergence from CARD_SPEC.md Part 3, confirmed

**Which of the five spec actions are actually reachable today?**

| Action | Reachable? | How |
|---|---|---|
| Link to order | Narrowly | `belongs_to_existing_order` only — exact `orderNumber` match. `duplicate` (the other reason mapped to this action) is never produced for email-kind rows — no dedup key exists (documented gap, `lib/needsReviewRows.ts:58-66`). |
| Create new order | Over-broadly | `real_purchase_no_record` is the **only fallback** `detectEmailReviewReason` can produce — so this action fires for every orphan that isn't an exact orderNumber match, regardless of whether there's any actual purchase signal. |
| Not a purchase | **No** | No reasonId ever routes here. `lib/needsReviewActions.ts`'s own comment (L38-40) says so explicitly — non-commerce detection is out of the 2026-08-21 cheap-version scope. Known, documented, not an oversight. |
| View detail | Only for order-kind, unconditionally | `lib/needsReviewActions.ts:43-44` forces **every** order-kind row to View detail regardless of its `reasonId` (order-to-order merge is deferred — separate decision, not part of this design). For email-kind rows, the "unmapped reason degrades to View detail" `else` branch (`needsReviewActions.ts:49-51`) is **dead code** today: `detectEmailReviewReason` only ever returns two reasonIds, and both are mapped. |
| Nothing | No | No reasonId routes here. By design (Q9 extensible registry), not a bug. |

**Is the "degrade to View detail" default implemented?** Yes, mechanically —
but it's unreachable for email-kind rows given the current classifier's
narrow two-value output space. The earlier same-day diagnostic phrased this
as "the fallback goes to Start a new order via `needsReviewActions.ts:47-48`,"
which is true as an *outcome* but locates the bug one layer too low. The
action-mapping layer is not the problem — `real_purchase_no_record` really
does map to "Create new order" per spec's own table (`CARD_SPEC.md:223`).
**The actual bug is one layer up, in `detectEmailReviewReason`
(`lib/needsReviewRows.ts:67-74`): its own fallback conflates "genuinely
looks like a purchase, just no exact number match" with "we have no idea
what this is," and asserts the former's confident reasonId for both.**

**Is the 2026-08-21 rebuild's "CARD_SPEC.md Part 3 compliance" claim fully
accurate?** Not fully — three gaps, all cross-referenced below (§5) rather
than re-litigated here since two are already tracked:

1. **New finding, this design pass:** the spec names "extraction failures"
   as one of the four populations feeding the bucket (`CARD_SPEC.md:248-251`),
   but no email-kind reason branch represents it — it's silently absorbed
   into `real_purchase_no_record`, which is supposed to mean something
   more specific and more confident than "we know nothing." This is a
   real compliance gap, not a scope cut — propose logging as 🐛 Bugs (§6).
2. **Already tracked** (TASKS.md 🟡 Next "Full-detection reason mapping"):
   no real not-e-commerce detection, no email-kind duplicate detection.
   Documented as an explicit, owner-locked scope cut at rebuild time — not
   re-flagged here as new.
3. The 12-row 7/21 ingestion incident (TASKS.md 🐛 Bugs → Trust-breaking)
   already explains *why* 3 of this session's 18 orphans (the Whole Foods
   triplet, idx 13-15 below) have `extractedAt IS NULL` — a data-arrival
   problem, unrelated to and not fixed by this routing-tree design. Cited
   here only because those same 3 rows are also evidence for finding #1.

---

## 2. Proposed population → action mapping

Four branches, checked in priority order, for **email-kind rows only**
(order-kind rows keep their existing, separately-scoped behavior — always
View detail, per `needsReviewActions.ts:43-44`; not touched here).

```
1. orderNumber exact-matches an existing order
   → belongs_to_existing_order (unchanged)          → Link to order

2. emailType ∈ {return_label, refund}
   → return_or_refund_no_link (NEW)                 → Link to order (manual picker)

3. emailType ∈ {order_confirmation, shipping_confirmation, delivery}
   AND (retailer present OR orderNumber present)
   → real_purchase_no_record (unchanged reasonId, narrower trigger) → Create new order

4. everything else (emailType null/other, or zero signal at all)
   → no_extraction_signal (NEW)                     → View detail (degrade)
```

**Why branch 2 exists — this is the actual H&M-case fix.** A
`return_label`/`refund` email is definitionally about an order that already
exists — you cannot return or be refunded for something with no prior
purchase. Per `CARD_SPEC.md:228-231`'s own reasoning, "Create new order" is
specifically for when there is **nothing to attach to**; a return-side
email is structurally the opposite case, regardless of whether an exact
`orderNumber` match happens to be found. Fabricating a new "order" from a
refund confirmation would misrepresent the data — there's no purchase
information in a refund email to seed an order with in the first place.
This is not an `emailType` gate bolted on for its own sake; it's the
correct application of spec's existing Create-vs-Link distinction to a
case the spec didn't explicitly enumerate.

**Why branch 4 exists.** `no_extraction_signal` gives `detectEmailReviewReason`
an honest way to say "we don't know," instead of forcing every non-match
through the confident, specific `real_purchase_no_record` sentence
("This looks like a real purchase with no order record"). This is exactly
CARD_SPEC.md's own degrade principle (§244-247: "any reason with no
registered mapping degrades to View detail, never throws") — it just
requires the classifier to actually produce an unmapped-shaped reason
instead of silently coercing everything into a mapped one.

**Reason text (slot-3, full sentence, per spec's voice/format):**
- `return_or_refund_no_link`: *"This looks like a return or refund for an order we don't have on file."*
- `no_extraction_signal`: *"We couldn't extract any details from this email."* (Deliberately distinct from the existing `uncertain_details` sentence, "We're not certain about **some** details" — that phrasing implies partial extraction succeeded; these rows have nothing. See §5 for the proposed spec amendment this requires.)

**Deliberately unchanged / not re-solved here** (same cheap-version scope
discipline as the 2026-08-21 rebuild, tracked separately):
- Email-kind `duplicate` detection — no canonical dedup key exists yet.
- Real not-e-commerce detection (`emailType === "other"` currently has no
  positive signal to route on; it falls through to branch 4, which is a
  safe degrade, not a fix).
- Order-kind rows' forced View detail (a separate, larger decision about
  order-to-order merge machinery — out of scope for this design).

---

## 3. Verification against the current 19-row population

Full per-row table with `current_action` vs `proposed_action`:
`scripts/pm-design-needsreview-routing-tree-20260824.ts` (run it for live
data — this is a snapshot as of 2026-08-24).

**Result: 8 of 18 email-kind rows change action, all from "Start a new
order" → "More info."** Zero rows move to "Merge with existing order"
under branch 2 in *today's* snapshot — no currently-orphaned email has
`emailType` return_label/refund (every such email in the DB is already
linked; see the earlier same-day diagnostic). Branch 2 exists for the
next time this shape recurs (it's what would have caught the original H&M
case, had that email still been orphaned when this ships), not because it
changes anything visible today.

The 8 changed rows split into two evidentially distinct groups, both
correctly routing to View detail under the proposed tree but for different
underlying reasons:
- **3 rows (idx 13-15, Whole Foods pickup triplet):** `extractedAt IS NULL`
  — extraction never ran. Root cause already tracked: TASKS.md 🐛 Bugs →
  Trust-breaking, "7/21/2026 ingestion incident." This design doesn't fix
  *why* they never extracted — it just stops asserting a false "real
  purchase, no order record" claim about them in the meantime.
- **5 rows (idx 3,4,5,6,9):** extraction ran (`extractedAt` populated),
  emailType resolved (delivery/shipping_confirmation), but **no retailer
  and no orderNumber** — consistent with generic carrier-tracking pings
  (USPS/FedEx domains, confirmed in the earlier diagnostic's residue
  tagging) rather than genuine extraction failure. These likely overlap
  with the separately-tracked bucket-residue-cleanup 🟡 Next task's
  USPS-pregating sub-population — expected overlap, not a conflict; the
  routing-tree fix and the residue sweep are two independent, complementary
  cleanups of the same visible symptom.

No row moves to "Not a purchase" (Archive) — that population still has no
detector, unchanged from today, tracked separately.

---

## 4. Prisma-select changes required

Only **`emailType`** needs to be added to the two call sites' `select`
clauses — it isn't fetched today:

- `app/(app)/page.tsx:86`
- `app/(app)/needs-review/page.tsx:36`

`retailer` and `orderNumber` are already fetched at both sites; nothing
else in the proposed tree's branch conditions reads any other field.
`extractedAt` is useful for diagnostics/monitoring (as shown in §3's
breakdown) but is **not** a routing input under this design — the tree
doesn't need to distinguish "never extracted" from "extracted but empty,"
since both correctly land on the same `no_extraction_signal` branch. Not
proposing to add `extractedAt` to the select for routing purposes.

`EmailReviewInput` (`lib/needsReviewRows.ts:49-56`) needs an `emailType:
string | null` field added to match.

---

## 5. Proposed CARD_SPEC.md Part 3 amendments (for owner review — not applied)

Three gaps in the spec text itself, surfaced by this design pass. None
applied to `CARD_SPEC.md` — proposed here for owner sign-off first, same
discipline as the rest of Part 5's decision log.

**A. Population list omits "non-commerce."** `CARD_SPEC.md:248-251` lists
four populations feeding the bucket (orphaned genuine-commerce, linked-but-
flagged, duplicates, extraction failures) but the reason table (`:221`)
defines a reason + action for "We think this may not be e-commerce" — a
fifth population the list never names. Either the population list is
incomplete, or that reason/action pair is aspirational and should be
marked as such until a real population feeds it. **Proposed amendment:**
add "possible non-commerce (no detector yet, reason/action pair reserved)"
as a fifth named population, explicitly marked not-yet-built, so the spec
and the code's known gap agree.

**B. No canonical sentence for total extraction failure.** The reason
table's closest entries (`missing_order_date`, `missing_order_total`) both
assume *some* extraction succeeded (a specific date or total is
identifiably missing). Nothing in the table represents "we couldn't
determine anything about this email" — which is exactly why
`lib/needsReviewReasons.ts`'s own top comment (2026-08-21) already had to
freelance a sentence for `uncertain_details` and note it "has no canonical
spec sentence." **Proposed amendment:** add *"We couldn't extract any
details from this email."* → View detail as its own row in the reason
table, distinct from the `uncertain_details`/"some details" sentence,
formalizing what the code already had to invent ad hoc.

**C. No guidance on return/refund emails' Create-vs-Link default.** The
spec explains *why* Create new order exists (no target to attach to,
`:228-231`) but never states the converse: that a return_label/refund
email structurally implies a target must exist, so it should never
default to Create. **Proposed amendment:** add a sentence to that same
paragraph: "Return- or refund-typed emails imply a prior order exists even
when no exact match is found — these should default to Link to order
(manual picker), never Create new order."

---

## 6. Disposition: this session's scripts

- `scripts/pm-diag-needsreview-action-routing-20260824.ts` — the original
  read-only audit script from the earlier same-day diagnostic session.
  **Deleted 2026-08-24 close-out**, per this disposition proposal. Its
  useful findings (root cause, count reconciliation, residue tagging, the
  4-deferred-rows check, the Chan Luu check) are all captured in TASKS.md's
  diagnostic entry and this design doc; it didn't need to persist as a file.
- `scripts/pm-design-needsreview-routing-tree-20260824.ts` — **committed**,
  this design's pre-code verification artifact. Durable: rerun it anytime
  to check the proposed tree against live data before/after build.

---

## 7. Post-review decisions [2026-08-24 close-out]

- **Spec amendments A and B: applied** to `CARD_SPEC.md` Part 3 — same
  commit as this section's addition (see `git blame CARD_SPEC.md` /
  `git log --oneline -- CARD_SPEC.md` for the hash). Amendment A added
  "possible non-commerce (no detector yet, reason/action pair reserved)"
  to the populations list. Amendment B added "We couldn't extract any
  details from this email." → View detail as its own reason-table row,
  plus a clarifying bullet distinguishing it from a generic
  "some details are uncertain" sentence.
- **Spec amendment C: deferred, not applied.** Reasoning: zero rows in the
  current 18-row orphan population exercise branch 2
  (`return_or_refund_no_link`) — every `return_label`/`refund` email in the
  DB today is already linked, so there's no live data yet to validate the
  proposed spec wording against. `CARD_SPEC.md` carries a dated note
  instead (Create-vs-Link discussion) recording that this was considered
  and deferred, so a future session doesn't re-propose it from scratch.
  Revisit once a real `return_label`/`refund` orphan actually reaches the
  bucket and exercises branch 2 in practice.
- **Owner UX call formalized as `CARD_SPEC.md` Part 3 amendment D**, same
  commit as this update (see `git log --oneline -- CARD_SPEC.md` for the
  hash). Build session inherits the spec-current rule — no reconciliation
  needed at build-session start.

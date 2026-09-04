# 🟡 Next consolidation proposal — returnPortalUrl alpha reframe, 2026-09-02

Read-only survey. TASKS.md was NOT edited as part of this task (the two new
🔴 Now items and the new "Retailer URL / policy cache" 🟡 Next item that
appear in TASKS.md as of this writing were added in a prior step of this
session, before this housekeeping task started — not part of this proposal).
0 Anthropic API calls.

## Summary

- 🟡 Next contains **98 items** total.
- Full section text was swept for every returnPortalUrl/retailer-policy/
  extraction-prompt/merge-logic/self-email/trust-tier keyword (`returnPortalUrl`,
  `retailer polic`, `retailer.*cache`, `extraction prompt`, `merge-logic`,
  `Self-email ingestion`, `return-portal`, `prompt iteration`, `extraction
  quality`, `extraction guard`, `resolveReturnPortalUrlForWrite`), not sampled.
- **9 items matched** and were read in full for judgment.
- **3 flagged for a change**; 6 judged unaffected (bucket counts below).

| Judgment | Count |
|---|---|
| (a) Unaffected | 6 |
| (b) Fully superseded | 1 |
| (c) Partially superseded / reword | 1 |
| (d) Overlaps a new 🔴 Now item / consolidate | 1 |

---

## Flagged items

### 1. "Self-email ingestion loop — reject own outbound at inbound webhook" (🟡 Next, current line ~3249)

**Current text (verbatim):**
> **Self-email ingestion loop — reject own outbound at inbound
> webhook.** Investigation completed 2026-09-01 (three passes,
> conversation-only — no Done entry filed for the investigation
> itself, this Next item is the only written record): users' Gmail
> auto-forward rules — the same kind of
> rule our onboarding sets up — route our own outbound reminders/
> digest/refund-check-in emails back into our own inbound pipeline.
> 27 self-emails ingested across 5 users in the last 90 days; 3-4
> corrupted an Order's `returnPortalUrl`. Loop is structural (a
> product feature colliding with itself), won't self-resolve on its
> own, though the boomerang rate is inconsistent per user (4%-57% of
> sends, not every send — confirmed via a precise Reminder-table
> comparison, not blanket forwarding).
> **Fix shape from investigation:** an ingestion guard rejecting any
> email whose (a) From: / Return-Path / envelope sender matches our
> own sending addresses/domain, OR (b) `classifyForwardType()`
> returns `"auto"` AND the header chain contains our own sending
> address/domain/inbound token. The signal is already computed in
> `classifyForwardType` at ingestion — just not currently acted on.
> Plus: null the 3-4 corrupted `returnPortalUrl` rows on ship.
> **Deferred concerns from investigation — do NOT fold in when
> picked up, separate work:** audit of whether the 23 self-emails
> that didn't corrupt `returnPortalUrl` silently corrupted other
> fields; the merge-side trust hierarchy in
> `resolveReturnPortalUrlForWrite` (always prefers email-stated URL
> over an existing good value); fancier self-email detection via
> subject/content fingerprinting.

**Judgment: (d) overlaps with new 🔴 Now item.**

This is the exact same work as the new 🔴 Now item "Self-email
ingestion loop fix" — same fix shape (reject at webhook via
`classifyForwardType`/sender-domain match), same null-out cleanup.
The 🔴 Now item's current text is terser and does not carry this
item's richer investigation detail: the 27-emails/5-users/3-4-corrupted
count, the 4%-57% per-user boomerang-rate finding, or the explicit
"deferred concerns — do NOT fold in" list (23 non-corrupting
self-emails possibly corrupting other fields silently; the
`resolveReturnPortalUrlForWrite` merge-trust-hierarchy question,
which investigation-one separately closed as "acceptable, no code
fix warranted" — worth preserving that resolution here too so it
isn't re-litigated next time someone reads this item).

**Recommended action: consolidate.** Close this 🟡 Next item with a
"superseded by 🔴 Now" note, and replace the 🔴 Now "Self-email
ingestion loop fix" item's text with the following merge — the
existing Now item's own sentences are kept as-is; the fleet data and
deferred-concerns list are inserted **verbatim** from the 🟡 Next
item's text above (not paraphrased):

> - [ ] **NEW 2026-09-02 — Self-email ingestion loop fix.** Reject
>       own outbound reminder/digest/refund-check-in emails at the
>       inbound webhook so they never reach the extraction pipeline
>       and clobber good returnPortalUrl values with self-domain
>       URLs. Absorbs the null-out cleanup for the 3 affected rows
>       (previously scoped inside the closed self-domain
>       correctness bug item). Scope: webhook-level filter only,
>       not merge-logic changes. Investigation-one confirmed
>       generic merge-logic behaviour ("last non-null wins") is
>       acceptable when extraction is well-behaved and the alpha
>       review flow catches the rest — no code fix warranted at
>       merge layer.
>       **Investigation detail (absorbed from the closed 🟡 Next
>       item "Self-email ingestion loop — reject own outbound at
>       inbound webhook," investigation completed 2026-09-01):**
>       users' Gmail auto-forward rules — the same kind of rule our
>       onboarding sets up — route our own outbound reminders/
>       digest/refund-check-in emails back into our own inbound
>       pipeline. 27 self-emails ingested across 5 users in the
>       last 90 days; 3-4 corrupted an Order's `returnPortalUrl`.
>       Loop is structural (a product feature colliding with
>       itself), won't self-resolve on its own, though the
>       boomerang rate is inconsistent per user (4%-57% of sends,
>       not every send — confirmed via a precise Reminder-table
>       comparison, not blanket forwarding). **Fix shape from
>       investigation:** an ingestion guard rejecting any email
>       whose (a) From: / Return-Path / envelope sender matches our
>       own sending addresses/domain, OR (b) `classifyForwardType()`
>       returns `"auto"` AND the header chain contains our own
>       sending address/domain/inbound token. The signal is already
>       computed in `classifyForwardType` at ingestion — just not
>       currently acted on. **Deferred concerns from investigation
>       — do NOT fold in when picked up, separate work:** audit of
>       whether the 23 self-emails that didn't corrupt
>       `returnPortalUrl` silently corrupted other fields; the
>       merge-side trust hierarchy in `resolveReturnPortalUrlForWrite`
>       (always prefers email-stated URL over an existing good
>       value); fancier self-email detection via subject/content
>       fingerprinting.

Note the deferred-concerns list's middle clause (the
`resolveReturnPortalUrlForWrite` merge-trust-hierarchy question) was
written *before* investigation-one ran and investigation-one has
since answered it (see the Now item's lead paragraph: "no code fix
warranted at merge layer") — preserved verbatim anyway per
instruction, since it's presented as a historical record of what the
2026-09-01 investigation left open, not a live open question; the
lead paragraph's resolution already supersedes it in context, no
contradiction.

**Rationale:** two items describing the same fix invite drift (one
gets built, the other silently goes stale) — folding the
investigation record into the 🔴 Now item preserves the evidence
trail without leaving a duplicate open in 🟡 Next.

---

### 2. "Stale return-portal URLs from web_lookup — trust-tier the field" (`returnportal-trust-tier`, current line ~4371)

**Current text (verbatim):**
> **Stale return-portal URLs from web_lookup — trust-tier the
> field** — WNU's `returnsportal.co` URL was extracted from
> web_lookup and is a defunct provider (redirects to Swap Commerce,
> acquired). AI-extracted portal URLs can be stale from
> indexed-but-outdated sources. Proposal: low-confidence
> `returnPortalUrl` values surface as "Start return at [retailer]"
> linking to retailer's own returns landing page rather than the
> direct portal. Bigger UX change than a prompt tweak. May become
> largely moot for high-volume retailers once retailer policy DB
> ships (curated URLs). Real evidence: WNU on Caroline's dashboard.
> Slug: `returnportal-trust-tier`.
> **AMENDED 2026-09-01, from Start-return CTA coverage
> investigation:** original framing was WNU as one data point.
> Spot-check of 10 random `returnPortalUrl` values now in production
> found 3-4 clearly broken (Buff City Soap → contact page, Gap →
> cookie failure, Wayfair → 404), plus 3 Amazon URLs returning 200
> but landing on a generic claim-auth flow that may not resolve to
> the user's specific order. Real bad-URL rate estimated at 30-40%,
> not a one-off. Higher priority than originally scoped, and the
> "degrade low-confidence values" remedy needs sharpening — the bad
> URLs weren't uniformly low-confidence, and static URL health
> checks won't catch semantic wrongness (Amazon case). Spec pass
> required before build.

**Judgment: (b) fully superseded.**

This item's entire remedy shape — infer a confidence signal from
`policySource`/extraction metadata and degrade the UX for
low-confidence values — is exactly the approach the 2026-09-02
root-cause investigation (`investigations/2026-09-02-extraction-root-cause/`)
found doesn't work: confidence at extraction time doesn't predict
correctness (category C's "no good URL existed" rows and category F's
"correct at write time, decayed since" rows both slip past any
extraction-time confidence signal), and the owner's alpha reframe
explicitly takes the opposite approach — verified human approval as
source of truth, extraction demoted to best-effort background input.
The alpha weekly search-and-verify item directly replaces this item's
purpose (getting users a trustworthy URL) with a mechanism that
doesn't depend on trust-tiering extraction confidence at all.

**Recommended action: close**, with this closure note:

> **CLOSED (superseded) 2026-09-02 — `returnportal-trust-tier`.**
> Superseded by the alpha weekly search-and-verify flow. **Why:**
> extraction-time confidence doesn't predict correctness — the
> root-cause investigation found bad URLs weren't concentrated in
> low-confidence rows (categories C and F both slip past any
> confidence signal) — so trust-tiering the field can't reliably
> catch what verified human approval catches instead. See 🔴 Now
> "Self-email ingestion loop fix" and "Alpha weekly search-and-verify
> for returnPortalUrl"; see
> `investigations/2026-09-02-extraction-root-cause/` (traces.md,
> eval-set.jsonl) for the underlying evidence.

**Rationale:** keeping this open invites a future session to spec
and build a confidence-degrade UX that the owner has already
decided against in favor of alpha review — closing it now prevents
that rework.

---

### 3. "Retailer policy database" (current line ~4348)

**Current text (verbatim):**
> **Retailer policy database** — NOT tomorrow, needs its own
> session — for high-volume retailers where we can justify curation
> (Moda, Shopbop, Nordstrom, J.Crew, Amazon, and the next ~15-25),
> maintain a known-good record of return policy: window(s), tiering
> conditions, refund vs. store credit windows, return portal URL,
> sale-item exclusions, anchor (order date vs. delivery date).
> Extraction priority becomes: retailer-known-policy → email →
> web_lookup → guess. Deeply entangled with the tiered-policy schema
> work below (likely one shared schema, one shared spec pass).
> Highest-quality trust upgrade for extraction and the most complete
> answer to WNU-class stale-URL bugs. Data-model change + governance
> question (audit cadence, ownership). Spec in BUILD.md before
> Claude Code touches it. Real evidence: Moda + Shopbop both
> surfaced today from a single walkthrough.

**Judgment: (c) partially superseded.**

The item bundles several fields into one future curated record:
window(s), tiering conditions, refund-vs-credit windows, **return
portal URL**, sale-item exclusions, anchor date. Of these, only the
return-portal-URL piece is superseded — that piece is now the job of
the alpha weekly search-and-verify mechanism (and, later, the new
"Retailer URL / policy cache — long-term" 🟡 Next item, which is
explicitly gated on 4-6 weeks of alpha-review data). The remaining
fields (return window length, tiering conditions, refund-vs-credit
distinction, sale-item exclusions, anchor date) are untouched by the
alpha reframe — nothing in this session's investigations or the
owner's alpha decision addresses return-window/tiering curation at
all.

**Recommended action: reword**, narrowing the field list to remove
"return portal URL" and cross-referencing the new item:

> **Retailer policy database** — NOT tomorrow, needs its own
> session — for high-volume retailers where we can justify curation
> (Moda, Shopbop, Nordstrom, J.Crew, Amazon, and the next ~15-25),
> maintain a known-good record of return policy: window(s), tiering
> conditions, refund vs. store credit windows, sale-item exclusions,
> anchor (order date vs. delivery date). **Return portal URL
> curation is no longer this item's scope as of 2026-09-02 — see
> "Retailer URL / policy cache — long-term" below, gated on alpha
> review data.** Extraction priority becomes: retailer-known-policy
> → email → web_lookup → guess. Deeply entangled with the
> tiered-policy schema work below (likely one shared schema, one
> shared spec pass). Highest-quality trust upgrade for extraction.
> Data-model change + governance question (audit cadence,
> ownership). Spec in BUILD.md before Claude Code touches it. Real
> evidence: Moda + Shopbop both surfaced today from a single
> walkthrough.

Also touches the "Stale return-portal URLs..." item's line "May
become largely moot for high-volume retailers once retailer policy
DB ships (curated URLs)" — moot regardless once item 2 above is
closed, no separate action needed there.

**Rationale:** without this edit, a future session speccing the
retailer policy database would still design a return-portal-URL
curation field that duplicates the alpha-derived cache — narrowing
scope now avoids two competing URL-curation designs.

---

## Unaffected (reviewed, no action) — brief note only, per scope

- **`extraction-cost-visibility` PHASE 1b — policy-lookup-cache**
  (per-retailer positive cache for `lookupReturnPolicy` AI calls):
  about *cost*, not URL correctness — `lookupReturnPolicy` also
  returns return-window/deadline data, which the alpha reframe
  doesn't touch. Unaffected, though its value proposition for the
  URL-specific portion of that call may shrink over time; not a
  judgment call for this pass.
- **`policysource-url-provenance-imprecision`** and
  **`m2-tier-log-remove-after-measurement`**: both belong to the M2
  `classifyReturnPortalTrust` security/disclosure feature (mobile
  quick-check audit), a different mechanism and purpose from the
  extraction-quality trust-tier item closed above. Unaffected.
- **"Full-detection reason mapping for the needs-review bucket"**:
  mentions `return-portal-untrusted` only as one of several
  needs-review reason labels being collapsed into
  `uncertain_details`; UI/reason-labeling concern, not extraction or
  merge logic. Unaffected.
- **"Watching: Amazon extraction quality"**: general Amazon
  extraction quality, not returnPortalUrl-specific — Amazon orders
  are excluded from the reminder flow entirely (`isAmazonOrder()`
  skip), so this item was never in the returnPortalUrl problem space.
  Unaffected.
- **"Tiered return policies + store credit tracking"**: cross-refs
  the retailer policy database item above but is itself about
  window/tiering/credit logic, not URLs. Unaffected.

---

## What this proposal does NOT include

Per scope: no new work items proposed beyond consolidating existing
ones; 🔴 Now and ✅ Done were not reviewed (deliberately placed
today, not stale); TASKS.md itself was not edited — everything above
is a recommendation for the owner to apply or reject.

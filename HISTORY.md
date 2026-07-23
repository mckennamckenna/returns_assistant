# HISTORY.md — Return Window

Chronological build log, most-recent-first. Preserves commit hashes, root causes,
backfill counts, and verification details removed from BUILD.md and TASKS.md.

---

## 2026-07-23 — Decouple the delivered rung from deliveredAt: AquaTru actually fixed this time

The 2026-07-21 delivered rung (`8e27855`) derived `"delivered"` strictly from
`Order.deliveredAt != null`. AquaTru's two `delivery`-typed emails both have
`deliveredAt: null` — neither states a date anywhere extractable — so the
order that motivated the whole rung kept reading "Shipped." Confirmed and
self-flagged at the time (2026-07-21 close-out), left open pending an
explicit decision on whether to widen the derivation. This session made
that call and shipped it.

**Verify gate, before any code.** The question was whether "this order has
a confirmed delivery email" is cleanly queryable from where
`deriveDisplayStatus` runs, without plumbing new data through. It already
is: `recomputeDisplayStatus()` (`lib/linkOrder.ts`) builds `emailTypes` from
*every* email ever linked to the order (`prisma.email.findMany({ where: {
orderId } })`), not just the one that triggered the recompute, and that
array was already the first parameter passed into `deriveDisplayStatus`.
`emailTypes.includes("delivery")` was already sitting right there, already
order-level, already stable — no new field, no new query, no new plumbing.
Reported clean, proceeded to build.

**Build.** `deriveDisplayStatus`'s ladder: `deliveredAt != null` **OR**
`emailTypes.includes("delivery")` → `"delivered"`. `deliveredAt` stays the
more precise signal when present (a real confirmed date); the email-type
check is the fallback that catches AquaTru's shape. The old
`shipping_confirmation`-or-`delivery` disjunction for the `"shipped"` branch
collapsed to `shipping_confirmation` alone, since any `delivery` email type
now always resolves to `"delivered"` first — not a behavior gap, the
`"shipped"` branch was structurally unreachable by a `delivery` type either
way once the `"delivered"` check runs first. Rank position, the never-
downgrade rule, the refund-branch exemption, the `"kept"` guard — none of
that touched.

**Three loose ends from the original rung build, explicitly closed, not
re-guessed:**
1. **Delivered-AND-mid-return test** — already existed, twice, but only
   exercised the `deliveredAt` signal (`return_label` arriving on an
   already-`"delivered"` order; the combined-signal case with `deliveredAt`
   set). Added the equivalent pair for the *new* signal: a `delivery` email
   plus a `return_label` in the same call, `deliveredAt` null throughout —
   confirms `return_label` still wins via the widened path too, not just the
   original one.
2. **Hardcoded rank integers** — re-ran the same grep as 2026-07-21
   (every `*Rank`/`*rank` identifier against a numeric literal, both
   directions, across `app/`, `lib/`, `scripts/`, `__tests__/`). Still zero
   hits. The renumber's safety assumption still holds.
3. **Backfill coverage** — checked the existing `scripts/backfill-delivered-status.ts`
   directly: its candidate query was `displayStatus in (ordered, shipped) AND
   deliveredAt: { not: null }` — deliveredAt-only, which is exactly why it
   could never have caught AquaTru on the first run, regardless of when it
   ran. Widened to `deliveredAt != null OR a linked "delivery"-type email
   exists` (Prisma `OR` with a nested `emails.some`). Dry run found 8
   eligible orders (AquaTru, Bettervits USA, ACE VISALIA RSC, Tuckernuck,
   Freda Salvador, Amazon, Old Navy, DONNI — same root shape across several
   retailers: a `delivery` email with no extractable date). Applied.
   **Verified directly against production, by order id, after applying:**
   AquaTru now reads `displayStatus: "delivered"`, `deliveredAt` still
   honestly `null`, internal `status` still `"returnable"` — the badge and
   the date field are allowed to disagree, by design; that was always the
   point.

**Tests.** 2 new (the AquaTru-exact case: `delivery` email, `deliveredAt`
null, from `"shipped"` → `"delivered"`; the AquaTru-shaped combined case:
`delivery` + `return_label` together, `deliveredAt` null throughout →
`"return_requested"`, not `"delivered"`). 3 existing tests updated — the
old "delivery implies shipped" assertions now correctly expect
`"delivered"`, an intentional behavior change flagged as such in the test
names/comments, not silently patched over. 452/452 total passing, `npm run
build` clean.

**`delivery-emails-missing-date` (`TASKS.md` 🟡 Next) reframed, not
closed.** The remaining 15 (of 33 project-wide) `delivery` emails with no
extractable date no longer produce a wrong *badge* — they now correctly
show `"Delivered"`. What's left is purely that `deliveredAt` itself stays
`null` for them, so anything that wants an actual date (not just the fact
of delivery) still has nothing to show. A real, smaller, differently-shaped
gap than the one this session closed.

**Status: committed, pushed, and deployed.** Four prior local commits
(`8e27855` displayStatus rung + autoArchive fix, `d8e9752` carrier-link
probe, `7078716` forward-classifier logging, `54fe13f` junk mechanics) rode
along in the same deploy — expected and accepted, per this task's own
instruction; none of the three prior sessions' work was held back
artificially waiting for this fix. Junk auto-filing (`54fe13f`) is live as
of this deploy — the 168 existing non-commerce orphans identified before
this deploy stay un-junked until `scripts/backfill-junk-other-emails.ts`
is run separately (deliberately not bundled into this deploy). Awaiting
owner verification of AquaTru in production — not marked done until then.

---

## 2026-07-22 — Needs Review panel: verify gate + junk mechanics for non-commerce orphaned emails (backend only)

Two pieces this session, both spawned by the same original ask (build the
dashboard "needs attention" panel): a diagnostic verify gate that found the
assumed data model didn't exist, and — once that was resolved — the backend
data layer for one safe slice of it. No UI was built either time; the panel
component itself stays blocked on the owner's mock.

### Verify gate: the assumed "duplicate"/"not_ecommerce" flag types don't exist as stored data

The original task asked to build a registry keyed on two flag types the
owner expected to find in the data: `duplicate` and `not_ecommerce`.
Diagnostic-first, before any code: grepped the entire schema, `lib/orderReview.ts`,
`app/ReviewCard.tsx`, `lib/classify.ts`, and every admin page for either
literal identifier, plus the exact copy strings mentioned ("no return
policy", "not e-commerce") — zero hits anywhere. `Order.needsReview` and
`Email.needsReview` are both plain booleans; there is no stored "reason
code" or "flag type" field at all, confirmed via `orderReview.ts`'s own
comment.

Queried real production data instead of guessing further. Found **two
completely separate populations**, not one: 13 `Order.needsReview` rows
(surfaced today via `ReviewCard.tsx`'s "Needs review (N)" panel) and 206
orphaned `Email.needsReview` rows (`orderId: null` — surfaced today only as
a badge in "Unlinked emails," with **no resolve action other than a hard
delete**, confirmed a genuine dead end, logged as its own bug).

For "duplicate": the closest real mechanism (`retailerPrefixMatch`/order-
number-mismatch in `lib/linkOrder.ts`) already merges the email into the
target order *before* `needsReview` ever fires — there is no second Order
row and no queryable target-id field, so a "Merge" action has nothing left
to combine. Zero of the 13 real Order-level flags hit this code path live
right now (the closest analog, 3 orders with an `[auto] refund fallback
match` note, falls through `reviewReasonLabel()`'s priority chain to the
generic fallback instead — a real, separate, already-tracked gap,
`reviewreasonlabel-missing-reasons`).

For "not_ecommerce": sampled the 206 orphaned emails directly rather than
assume. 168 are `emailType: "other"`, confidence low or high, and every
single sample read was unambiguous marketing/promo copy (e.g. *"promotional
email from Microdosify... no order, purchase, shipment, or return"*) — a
real, clean, safe population. But 15 are genuinely commerce-typed
(`delivery`/`shipping_confirmation`/`order_confirmation`) with `orderNumber:
null` — real FedEx/UPS/USPS delivery notifications and order confirmations
(ACE VISALIA RSC, H&M, Poshmark, Good Eggs, Fitness Superstore, SilkSilky).
Cross-checked each: **12 of 15 have exactly one same-user, same-retailer
order already in the system, unmatched** — the existing fallback matcher
(`findRefundFallbackOrder`) only covers `refund`-typed emails, with no
equivalent for the other three types. Confirmed `deleteEmail`
(`app/actions.ts`) is a hard, immediate `prisma.email.delete()` with no
soft-delete or recovery — if `not_ecommerce`/Delete had been keyed on
anything looser than `emailType === "other"` (e.g. "no order number" or
"any orphaned email"), it would have offered a one-click irreversible
delete on 15 real order emails. A third population, 23 emails with
`emailType: null`, are genuine extraction failures (the `runExtraction.ts`
catch-block fingerprint) — a distinct case, never "not e-commerce" at all.

Logged the 15-orphaned-real-purchases gap as its own 🔴 Now item (not a
sub-bullet, per instruction) and the admin `?secret=` query-param auth
weakness as a 🟡 Next item, both surfaced during this diagnostic.
Rewrote the stale 2026-07-20 Decisions-log line (flat confirm+fix action
model) to record the real, current model: per-flag-type registry, `duplicate`
→ Merge or route-to-detail, `not_ecommerce` → Delete behind confirm,
unregistered → Review-only, never throws.

Also answered a standing question from the owner: the live "Needs review
(2)" panel with "Looks correct"/"Split into separate order" buttons
(`app/ReviewCard.tsx`) is confirmed **pre-existing** — introduced in commit
`b431fcb`, 2026-06-27, untouched by any commit this session. It has in fact
drifted from the current spec ("Looks correct" is exactly the inline
keep-it action the 2026-07-20 decision cut from v1; its layout isn't the
2×2 grammar) — real, flagged, not fixed here.

### Build: junk mechanics for the confirmed-safe `emailType === "other"` population (backend only, no UI)

Scoped explicitly to backend/data-layer only per the task — no views, no
panel, no admin cross-user UI, all blocked on mocks.

**Schema (`prisma/schema.prisma`):** `Email.junkedAt DateTime?` — soft
state, same shape as `Order.archivedAt`, `prisma.email.delete()` never
involved. New `EmailRescue` model — an **event log, not a counter**,
deliberately: `emailId`/`userId` both nullable with `onDelete: SetNull`
(same pattern as `ActionLog`'s `orderId`/`userId`) so a rescue rate stays
computable, per-user, even after the underlying email or user is later
removed. Migration `20260723022836_add_junk_flag_and_email_rescue` created
and **applied to the database** — additive only (one nullable column, one
new table), no data written, no destructive risk. Distinct fact from the
commit/push/deploy status below — see close-out.

**`lib/junk.ts`:** `shouldAutoJunk(email)` — pure function, deliberately
narrow: `orderId === null AND emailType === "other"`. Wired into the one
call site that can ever produce that state, `linkEmailToOrder`'s existing
orphan early-return (`lib/linkOrder.ts`) — `needsReview` is left set exactly
as before either way, so junking is a visibility layer on top of the
existing orphan state, not a replacement for it (a rescue restores the
email to exactly the state it would have had without ever junking).
`JUNK_FILTER` (`{ junkedAt: null }`) — the shared where-clause fragment,
same convention as `lib/orderFilters.ts`'s `activeOrderFilter`.
`rescueEmail(emailId)` clears the flag and writes the `EmailRescue` row in
one `$transaction`, returning the email's `userId` for caller attribution.
No auth/ownership check inside it — same convention as `orderReview.ts`'s
`approveOrder`/`splitOrder` ("callers are responsible for their own access
control"); not wired to any route yet.

**Consumer audit (same discipline as the displayStatus rung's
`autoArchive.ts` gap):** every `prisma.email.findMany`/`findFirst`/`count`
call site in the codebase checked. Two real consumers needed `JUNK_FILTER`,
both updated: `app/(app)/page.tsx`'s "Unlinked emails" list, and
`app/api/cron/weekly-coverage/route.ts`'s coverage-digest content query —
the latter is not scoped to `orderId: null` (it queries all of a user's
recent emails for the weekly "did we catch everything?" email), so it
needed checking explicitly and was a real, non-obvious find: a junked
marketing email would otherwise have shown up in a real outbound email as
an unexplained "did we catch this?" line. Every other email query is scoped
by `orderId`, which a junked email can never carry — those sites are
structurally unreachable and were left unchanged (enumerated in full in
`lib/junk.ts`'s own comment and `BUILD.md`).

**Backfill:** `scripts/backfill-junk-other-emails.ts` (dry-run default,
`--apply` flag, reuses `shouldAutoJunk` directly so it can't drift from the
live rule) — written and dry-run verified: **168 real emails eligible** as
of 2026-07-22 (the earlier verify-gate diagnostic counted 170 minutes
earlier in the same session; the live inbound webhook means this number
drifts in real time, not a discrepancy to chase). **Not applied** — dry run
only, per instruction.

**Verification.** `shouldAutoJunk` and `JUNK_FILTER` covered by 5 new pure-
function tests (450/450 total passing, `npm run build` clean).
`rescueEmail` is not pure (DB-touching, same as `approveOrder`/`splitOrder`
in `orderReview.ts`, which also have no direct unit tests — matches this
project's established convention). Verified directly instead: created a
throwaway test user + a synthetic junked email, called `rescueEmail()`,
confirmed `junkedAt` cleared, `needsReview`/`orderId` unchanged, and a
correctly-attributed `EmailRescue` row was written — then deleted all three
test rows. No real data touched.

**Not built, deliberately:** no junk view, no admin cross-user view, no
rescue UI, no route wiring for `rescueEmail`, no fix for the 15-orphaned-
real-purchases gap or the no-fallback-matcher gap underneath it (own
TASKS.md 🔴 Now item), no fix for the admin `?secret=` auth weakness (own
🟡 Next item).

**Status: committed locally. Not pushed, not deployed** — kept off the
AquaTru decouple deploy going out separately today, per instruction. Schema
migration applied to the database (see above) is a separate fact from app
deploy status — no application code that reads/writes `junkedAt` has
shipped to production yet.

---

## 2026-07-21 — Probe: carrier-link resolve + forward-classification audit (read-only, no fix)

Spawned by the AquaTru "Shipped forever" fix (same day, see below): AquaTru's
delivery email has no captured date anywhere, and the app was about to be asked
to decide between two possible fixes — (a) estimate a delivery date from the
forward timestamp when an email was auto-forwarded, (b) resolve the email's
carrier tracking link for an authoritative date. Both depend entirely on
knowing whether an email was actually auto-forwarded or manually forwarded —
and the UI's own "Forwarded by you" label, which the owner suspected was wrong
for AquaTru, turned out to be worth checking at the source rather than trusted.
Read-only throughout: no `displayStatus`, deadline, or schema writes.

**Finding 1 — the UI label isn't a classifier, it's a hardcoded string.**
`app/(app)/page.tsx:230` and `app/(app)/emails/[id]/page.tsx:76` both render the
literal text `"Forwarded by you"` unconditionally — no field on `Email` stores
an auto/manual verdict at all, so there was nothing to "get wrong" in the sense
of a broken derivation. Every email, regardless of actual origin, shows the
same string. This is a more fundamental gap than "the classifier misfires" —
logged as a new 🔴 Now bug (`forward-auto-manual-misclassification`).

**Finding 2 — AquaTru was in fact auto-forwarded, confirmed from raw headers.**
Decrypted `Email.rawJson` (the full stored Postmark inbound payload) for both
of AquaTru's delivery-typed emails and read the actual MIME headers Postmark
received:
- `Return-Path` contains Gmail's own `+caf_=` marker — Gmail's literal internal
  designation for **C**ontent **A**uto **F**orward, distinct from a manual
  "Forward" click.
- `X-Forwarded-For` / `X-Forwarded-To` headers present — Gmail's auto-forward
  relay headers, added only by that feature.
- The original sender's DKIM signatures (`aquatru.com`, `amazonses.com`) still
  validate (`dkim=pass`) and the top-level `From` is still `info@aquatru.com`
  — a manually-composed forward re-wraps the message and would break both.
- Timing: the earliest independent `Received:` hop (Gmail's own mail server
  logging receipt from AquaTru's ESP) to Postmark's own receipt was ~3 seconds
  — a fully automated relay chain, not human-paced.
This is as close to unambiguous as raw email headers get. The UI's "Forwarded
by you" label is simply wrong for this email.

**Finding 3 — full audit across all 34 delivery-typed emails: 24 auto, 10
manual, header-verdict vs. UI mismatch on all 24.** Same signal (`+caf_=` /
`X-Forwarded-For` presence, cross-checked against whether the top-level `From`
is the retailer's own domain vs. the user's own Gmail address) applied
uniformly. Spot-checked the "manual" bucket directly: e.g. an Old Navy delivery
email's top-level `From` is literally `mckenna.sweazey@gmail.com` (the user's
own address) — the unambiguous signature of a real manual forward, confirming
the heuristic isn't just pattern-matching noise. No "unknown" verdicts — every
email resolved cleanly to one bucket or the other.

**Finding 4 — send-vs-forward delta, two different (and correctly different)
measurement methods per bucket, one self-correction along the way.** First
pass compared `receivedAt` against the top-level `Date` header for the "auto"
bucket and got 0 for all of them — which is meaningless, not confirmatory: in
this codebase `Email.receivedAt` is set directly from the same Postmark
`payload.Date` field the top-level `Date` header populates
(`app/api/inbound/route.ts:239`), so that comparison was circular, not a real
test. Corrected it to use the earliest independent `Received:` header hop (the
receiving mail server's own logged timestamp, genuinely separate from the
message's self-reported `Date:` header) against `receivedAt` — this gave a real
signal: consistently under 3 minutes across all 24 auto-verdict emails
(max ~2.8 minutes, one DONNI email with an unusually long 9-hop relay chain).
For the 10 manual-verdict emails, `parseForwardedHeaderDate()` (existing
function, `lib/linkOrder.ts`, parses a quoted `"Date:"` line out of the
forwarded body text — this **is** a genuinely independent original-sender
timestamp for a manual forward) found a parseable original date on all 10,
with deltas ranging ~1 hour to ~165 hours (about a week) — real, meaningful
variance that confirms manual-forward delay is unpredictable and would make a
forward-date deadline estimate unreliable for that bucket, exactly as assumed.

**Finding 5 — gated subset size is genuinely ambiguous under the task's own
given definition, flagged rather than silently resolved.** "Not reliably
dated" was defined as "manually forwarded, OR body states no delivery date."
Read literally as an OR of two independent conditions, the gated subset
(delivery-typed AND not-reliably-dated) is 16 of 34. Read against the probe's
own stated purpose — forward-date estimation (feature a) already resolves any
auto-forwarded email with no body date, so only emails that are *both*
manually-forwarded *and* undated would still need a link-resolve (feature b)
— the gated subset is 9. The two readings disagree specifically on whether an
auto-forwarded-but-undated email (AquaTru's own shape) belongs in the
link-resolve subset or is fully handled by feature (a) alone. Reported both;
did not pick one to build against, since only the owner can settle this.

**Finding 6 — link-resolve probe: 0/6 resolved via plain fetch, real and
distinct failure reasons per target, one useful partial signal.** Attempted
paced (3s apart), real fetches against one representative link from each
distinct wrapper pattern found in the gated subset — did not attempt the full
set given the rate-limit hit on the third real content fetch (see below),
consistent with the "assume the endpoint rate-limits" guard:
- **AquaTru (`awstrack.me` → `wm.gy` → WISMOlabs):** HTTP 400, empty body.
  Consistent with a single-use or session-bound click-tracker token rather
  than a stable resolvable URL.
- **H&M (`hm.delivery-status.com`, parcelLab-branded, tracking number embedded
  directly in the URL query string):** HTTP 200, but the returned HTML is a
  raw, unrendered template — literal placeholders like `{{address_header}}`
  and `{{0.articleName}}` still in the markup, not filled in. Confirmed
  **render-required**, not a parsing gap on this probe's side — the real
  status data is populated by JS after page load, genuinely absent from the
  initial response.
- **Shopbop (own `orderdetail` page, UPS number embedded in the URL):**
  redirected straight to an Amazon/Shopbop OpenID sign-in wall. Not resolvable
  by plain fetch under any circumstances — would need the user's own
  authenticated session, not just a headless browser.
- **Old Navy (Narvar click-CTA):** redirected all the way to
  `https://www.google.com/?!=!` — looks like a bot-detection bailout rather
  than an expired link; a real browser session/UA might behave differently,
  unconfirmed here.
- **Tuckernuck (Klaviyo click-tracker):** HTTP 429 (rate-limited) on the
  content fetch — but notably the redirect chain *itself* resolved cleanly to
  a real, meaningful tracking page URL (`tnuck.com/pages/tracking?search=...`)
  before the 429 hit. The click-tracker unwrapping works; only the final
  content fetch was throttled. Worth a retry-with-backoff in any real build,
  not a dead end.
- **SilkSilky (Mailgun click-tracker):** HTTP 400, 11-byte body — same class
  of failure as AquaTru's, likely an expired or single-use token.
Per the operational guard, none of these are reported as "no delivery" or
"expired" — every failure is about the fetch, not the package. The task's
given failure taxonomy (timeout / not-found / render-required / rate-limited /
parse-failed) doesn't have a clean bucket for "redirected to a login wall" or
"redirected to what looks like a bot-detection page" — both were folded into
"parse-failed" for bucket-counting purposes but called out by name here since
they're operationally different problems (one needs the user's own session,
the other might need real browser fingerprinting/headers) than a generic
unparseable-response.
**Alternative path (raw carrier number in body, not resolved via API per
instructions — report only):** of the 16-email gated subset (interpretation
A), exactly 1 (Freda Salvador) had a directly regex-extractable raw USPS
tracking number in the body text under this probe's narrow pattern. AquaTru
itself also has one, matching the task's own claim, found under a separate,
looser check earlier in the investigation. Not a high hit rate across the full
gated set, but a real, cheap fallback signal worth keeping in mind for
whichever subset direction is chosen.

**Recommendation.** Auto-forward classification via the raw header signal
(`+caf_=` Return-Path marker, `X-Forwarded-For`/`X-Forwarded-To` presence) is
trustworthy enough to gate deadline-estimation logic on — it's unambiguous,
cheap to compute at ingestion time, and held up across all 34 emails with zero
ambiguous cases. Link-resolve, as tested here, is **not** viable via a plain
fetch — 0/6 succeeded, for at least three structurally different reasons
(single-use tokens, JS-rendered templates, auth walls) that a full
headless-browser render would only partially fix (it would not help the
Shopbop auth-wall case at all). Building link-resolve for real would mean a
real rendering pipeline plus session handling, a materially bigger lift than
this probe's scope, for a payoff that may not even be resolvable for every
retailer.

**Not built:** no classifier, no new schema field, no UI change, no
carrier-API integration. All temporary investigation scripts (`scripts/tmp/`)
deleted after use — nothing left behind beyond this write-up.
Committed locally at 2026-07-21 close-out (investigation-only commit,
`TASKS.md` + this entry). Not pushed, not deployed — there's no code to
deploy either way.

---

## 2026-07-21 — AquaTru "Shipped forever": new `displayStatus: "delivered"` rung, built and locally verified — not yet pushed/deployed/owner-verified

Promoted from the Annoying bucket into 🔴 Now same day. The bug: a delivered
order shows the literal badge "Shipped" indefinitely — `deriveDisplayStatus()`
(`lib/displayStatus.ts`) had no "delivered" rung at all, so `shipping_confirmation`
and `delivery` both collapsed to `"shipped"`. Label-honesty/trust bug, not a
deadline bug — `DaysLeftChip` reads `returnDeadline` directly and was never
affected.

**Design decisions (given, not re-derived):** `delivered` and the internal
`status === "returnable"` field are orthogonal — the badge answers "where's my
package," the deadline chip answers "how long to return." Derived strictly off
the persisted `Order.deliveredAt` field, never off the triggering email's
type, so the state is stable across later emails rather than only true in the
moment a `delivery` email is processed. Ladder placement: just above
`shipped`, below every return-related rung (`return_requested`/`returned`/
`refunded`/`kept`), so an order that's both delivered and mid-return shows the
more-advanced return state.

**Verify gate before building:** grepped every `DISPLAY_STATUS_RANK`
comparison site (`app/actions.ts`, `app/api/orders/[id]/status/route.ts`,
`lib/orderActions.ts`, `lib/returnedPageState.ts`, `lib/returnedAction.ts`,
plus the function itself) — confirmed every one is a threshold comparison
(`<`/`<=`/`>=`/`>`) against a named key, never a numeric literal or an
equality/between-range check. Safe to insert a new low rung and renumber
everything above it.

**Build:** `DISPLAY_STATUS_RANK` gained `delivered: 3` (ordered=1, shipped=2,
delivered=3, return_requested=4, returned/kept=5, refunded=6).
`DISPLAY_STATUS_LABELS` gained `"Delivered"`. `deriveDisplayStatus()`'s ladder
now checks `deliveredAt != null` (after `return_label`, before
`shipping_confirmation`/`delivery`) — so a return_label always wins over a
mere delivered signal, matching the ladder placement design. New
`Date | null` parameter, defaulted to `null` so the two historical backfill
scripts (`scripts/backfill-display-status.ts`,
`scripts/backfill-refund-status.ts`) keep compiling unchanged. The one real
call site, `recomputeDisplayStatus()` (`lib/linkOrder.ts`), now selects and
passes `Order.deliveredAt`. `prisma/schema.prisma`'s comment updated with the
new value set and precedence — no migration needed, `displayStatus` is a
plain `String` column.

**Full displayStatus-value-set consumer audit, prompted by an owner question
mid-review — not just rank comparisons.** Found one real gap:
`lib/autoArchive.ts`'s `NON_TERMINAL_STATUSES` was a name-based allowlist
(`["ordered","shipped","return_requested"]`), not a rank threshold — it would
have silently exempted every delivered order from the missed-window
auto-archive sweep. Fixed in the same change: `"delivered"` added, with a
new dedicated test (`autoArchive.test.ts`) confirming its inclusion. Checked
and deliberately left unchanged: `lib/reminders.ts`'s `SKIP_DISPLAY_STATUSES`
and `weekly-digest/route.ts`'s `EXCLUDED_STATUSES` (a delivered order's return
clock is still ticking — reminders/digest must keep including it);
`ALLOWED_MANUAL_STATUSES` correctly excludes `delivered` (never a manual
transition); `DisplayStatusBadge.tsx` needs no change (falls back to the same
neutral tint as shipped/ordered, label flows through automatically);
`lib/amazonBundle.ts` already keyed its own delivered/bucket logic off
`deliveredAt` directly, not `displayStatus`, so it was already correct.
Confirmed zero hardcoded rank integers anywhere in the codebase (grepped every
`*Rank`/`*rank` identifier against numeric literals, both directions).
Confirmed `SKIP_STATUSES` (internal `status`, the constant `63b88e4`'s
refund_pending fix touched) is a wholly separate constant from
`SKIP_DISPLAY_STATUSES` — no overlap with this change.

**A real gap in the test suite, caught by an owner question, not by review.**
The original tests covered "delivered" and "return_requested" signals in
isolation but not the case that actually exercises the ladder's if/else
priority: `deliveredAt` set AND a `return_label` email present in the SAME
derivation call, starting from a rank below both — exactly where an
evaluation-order bug would hide. Added two tests pinning this directly (from
`"ordered"` and from `"shipped"`), both confirming `return_label` is checked
before `deliveredAt`.

**Backfill: real, not hypothetical.** `recomputeDisplayStatus()` only fires on
new email ingestion, so any order that already had `deliveredAt` set before
this deploy would stay stuck at its old `displayStatus` indefinitely, not just
until the next email. Checked production directly: 4 real orders (ACE
VISALIA RSC, Whole Foods Market, Maisonette, DONNI) had `deliveredAt` set and
`displayStatus` stuck at `"shipped"`. New `scripts/backfill-delivered-status.ts`
(dry-run default, `--apply` flag, reuses `recomputeDisplayStatus()` directly)
— dry run matched expectations exactly, then applied. All 4 now read
`"delivered"` in production.

**AquaTru itself — the motivating example — does NOT advance, checked
directly against production, confirmed again at 2026-07-21 close-out.**
AquaTru's own `deliveredAt` is `null`: neither of its two linked
`"delivery"`-typed emails has a delivery date captured anywhere — not from AI
extraction (its own `extractionNotes` state no date is present in the email
body) and not from the forwarded-header-date fallback parser either
(`parseForwardedHeaderDate()` returns null on both — no `"Date:"` line in the
forwarded body; `receivedAt` is the only date on file for either email, and
it's explicitly the forward/envelope date, not a confirmed delivery date).
Using it as a `deliveredAt` stand-in would be exactly the fabrication this
design deliberately avoids. Logged as its own 🟡 Next item
(`delivery-emails-missing-date`) — a real, project-wide extraction gap (15 of
33 `delivery` emails project-wide have no captured date), not fixed here.
**Close-out decoupling question, resolved 2026-07-21:** a version of this
logic that derives "delivered" from the mere existence of a delivery-typed
email (regardless of a captured date) was discussed but never built — the
shipped code stays strict on `deliveredAt != null`. This is why AquaTru will
still read "Shipped" post-deploy, not a regression or an oversight.

**Verified locally:** `npm run build` clean, 445/445 tests passing (13 new +
2 more from a later review pass). Not yet pushed, not deployed, not
owner-verified in production — committed locally only as of 2026-07-21
close-out.

---

## 2026-07-17 — M1 fixed and owner-verified live: sign-in email no longer BCCs the admin (`505c7fb`)

Closes `SECURITY_AUDIT.md`'s M1 finding. The sign-in send (`lib/magicLinkRateLimit.ts`,
where the H1 Phase 3 refactor had incidentally relocated it from `auth.ts` without
touching it) carried `bcc: process.env.ADMIN_EMAIL` — every sign-in email, live
magic link included, was copied to the admin mailbox. Anyone with access to that
mailbox could complete login as any user by racing them for the single-use link.

**Investigation before the fix.** Audited every `bcc` and `ADMIN_EMAIL` reference
in the codebase first, per the session's explicit ask ("is any OTHER
credential-bearing email BCC'd anywhere"). Found exactly one BCC site
(`lib/magicLinkRateLimit.ts:121`) and confirmed `lib/postmark.ts`'s `bcc` param
is just the generic mechanism, not a second usage — no second finding to report.

**Fix.** Removed the bcc. Added a separate admin notification —
`notifyAdmin(subject, body, "magic_link_sent", email)`, new `NotificationKind`,
persisted as an `AdminNotification` row via the existing pattern — that names
who signed in and when, with no url/token/link. Two pure functions extracted so
this is unit-testable without jsdom, per the project's component-testing
philosophy: `buildSignInEmailPayload()` (the real user email, still contains the
real link, has no `bcc` field) and `buildSignInAdminNotification({ email,
signedInAt })` (the admin notification, an ISO timestamp + email only). 5 new
tests added; 2 pre-existing tests in the same file needed fixing because the new
per-successful-send admin notification changed call counts they were implicitly
relying on (`admin@example.com` also matches a `.includes("@example.com")`
filter one test used, and another destructured "the first admin call" assuming
only the rate-limit notification could produce one) — both switched to filtering
by notification subject instead of raw recipient/position. 359 total tests
passing, `npm run build` clean.

**Verification — two layers.** (1) Unit tests assert the properties directly:
no `bcc` key on the user payload, no url/token in the admin payload, no
notification at all for a non-allowlisted attempt (which never reaches the send
path). (2) Live production: after the fix deployed, a real `AdminNotification`
row was queried directly from the DB (not just observed via the test suite) —
`deliveryStatus: "sent"`, timestamp matched a real sign-in attempt, body
contained no `http://`/`https://`. Owner then independently verified end-to-end
in production 2026-07-17: a second allowlisted user (`mckenna@metaxmoda.com`,
added via `scripts/addAllowedSignIn.ts` mid-session) signed in successfully; the
admin mailbox received the link-free `magic_link_sent` notification and received
**no** sign-in email at all. `SECURITY_AUDIT.md` M1 closed same-day.

**Also flagged, not resolved.** `TASKS.md`'s Decisions log records the general
principle this fix embodies ("never BCC credential-bearing email") and explicitly
flags — without resolving — that it conflicts with the existing "Gmail
confirmation code will be delivered via email with owner BCC'd" decision and the
still-unbuilt `Auto-email Gmail confirmation code` Next item that depends on it.
Left for an explicit call before that item is picked up.

Committed (`505c7fb`), pushed, deployed (`dpl_2jsqLVFFAJbPHKT8KNxbTuEk1gAt`,
confirmed Ready and aliased to both `app.myreturnwindow.com` and
`returns-assistant.vercel.app`).

---

## 2026-07-16 — H1 rate limiting shipped across all three public endpoints, staged rollout (`9ea5ced`, `9357f5b`, `1f073ad`, `b44ac0f`, `903a9eb`, owner-verified live)

Closes `SECURITY_AUDIT.md`'s H1 finding ("no rate limiting or abuse controls
on any public endpoint"), rolled out one endpoint at a time across four
sessions, each phase deployed and owner-reviewed/verified before the next
began.

**Storage — Postgres, not Vercel KV/Upstash** (`9ea5ced`). New
`RateLimitCounter` model (`key` PK, `windowStart`, `count`), reusing the
existing Neon DB — zero new deps, effectively zero added cost at current
scale, and rate limiting itself reduces DB load under abuse (rejects before
hitting expensive paths). `lib/rateLimit.ts` exports `rateLimit({ key,
limit, windowSeconds })`. Fixed-window approximation (`windowStart` rounded
down to a `windowSeconds` boundary), explicitly not true sliding window —
the code comment names the trade directly: a burst straddling a window edge
can admit up to ~2x the limit in the worst case, judged not worth the
storage/read complexity of a real sliding window at this app's traffic
volume. Guarded atomic increment on the happy path mirrors
`lib/inboundVolume.ts`'s two-phase `updateMany` pattern (learned during the
Postmark C1 hardening work) — Postgres serializes concurrent `UPDATE`s to
the same row, so a burst can't lose an increment. One deliberate deviation
from that mirror, flagged and owner-approved: the miss/rollover path uses
`upsert` instead of a second guarded `updateMany`, because `RateLimitCounter`
rows don't pre-exist a key the way a `User` row always does (inbound
volume only ever updates an always-existing row) — `upsert` is Postgres's
correct atomic primitive for insert-or-update, with the same
tolerated-race properties as `inboundVolume.ts`'s own reset path. Cron
route (`app/api/cron/route.ts`) sweeps rows older than 24h alongside its
existing cleanup steps, no new `vercel.json` entry. 8 unit tests, shipped
inert (nothing wired into any endpoint yet).

**Phase 1 — `/api/inbound`, 30 messages/hour per `inboundToken`** (`9357f5b`).
Checked immediately after token resolution, before the volume counter,
Gmail-verification branch, or any classification/extraction work — a
blocked request does none of that. On block: 429 + `Retry-After`, no
`Email` row, `runExtraction` never called, inbound volume counter
untouched (a legitimate-flow signal, not an abuse signal — deliberately
kept as a separate concern). New `inbound_rate_limited` `NotificationKind`,
deduped 1/hour per token (`hasRecentNotification` gained an optional
`windowMs` param for this — every other existing caller keeps the 24h
default). 5 tests exercise the real rate-limit arithmetic through the
route (not mocked): 30 succeed, 31st blocks, window rollover resets, dedup
fires once across 5 rapid rejections, key carries the `inbound:` prefix.
Could not complete the originally-planned live 31-request curl stress test
against production — `INBOUND_WEBHOOK_PASSWORD` came back empty from
`vercel env pull`, consistent with being a write-only/sensitive Vercel env
var (matches the original Postmark-hardening rollout note: shown to the
owner once, never logged again). Owner's call: skip the live stress test
(unit tests already prove the 30/31 boundary; a real burst against
production proves wiring, not arithmetic) in favor of a single local curl
plus a real forwarded test email. **Verified live 2026-07-16** via
Postmark's activity log and a real forwarded email landing in the
dashboard.

**Phase 2 — `/api/beta-signup`, 3 signups/hour per IP** (`1f073ad`,
mislabeled "Phase 3" in that commit's own message — a clerical error, not
corrected via amend/force-push per the project's git-safety rule; this
entry and TASKS.md carry the correct numbering). IP read via the existing
`x-vercel-forwarded-for` `getClientIp` convention already used by
`app/api/action/{archive,returned}/route.ts` — diagnostic-first catch: the
task brief suggested `x-forwarded-for`/`x-real-ip`, but this codebase
already had an established, deliberate pattern for exactly this lookup
(mirrored per-route rather than shared, matching that existing
duplication style, with a documented `"unknown"` fallback if the header
is ever absent). On block: 429, no `BetaSignup` row created, no admin
notification for the block itself (low-value endpoint, don't clutter the
inbox). Separately fixes the H1-flagged notification-flood gap: the
pre-existing `notifyAdmin("beta_signup", ...)` call fired unconditionally
on every signup attempt; now gated through `hasRecentNotification` (24h
window, mirrors `allowlist_rejection`'s existing pattern) so repeat
submissions of an already-registered email can't flood the admin inbox.
8 tests. **Verified live 2026-07-16** via a real signup through the
marketing form.

**Phase 2 correction — tests + documentation, not a bug fix** (`b44ac0f`).
A later review flagged the `beta_signup` notification dedup as "per-kind,
one email per 24h regardless of unique signups," asking for per-email
dedup instead. Diagnostic check before writing any code: the shipped code
already deduped per kind+email, not per kind alone —
`hasRecentNotification`'s `relatedEmail` parameter is required for every
existing caller, so two different emails already produced two separate
notifications; only repeats of the *same* email within 24h were
suppressed, which is exactly the behavior the review asked for. The
review's test could only have used a single repeated email — that case
looks identical whether the dedup key is `kind` alone or `kind+email`, so
the two designs are indistinguishable without a second, different email in
the test. Reported to the owner before touching any code; confirmed as a
correct-code/wrong-assumption case, not a bug. Landed instead: 3
behavioral tests against the real `hasRecentNotification` logic (not
mocked) in `__tests__/betaSignupNotificationDedup.test.ts` (same email ×4
→ 1 admin email; two different emails → 2; same email again after the 24h
window → fires again), a one-line comment at the beta-signup call site
making the per-email intent visible rather than just implicit in argument
order, and a new Decisions log entry: attack-shaped signals
(`allowlist_rejection`, `inbound_rate_limited`) dedup per-kind; real-user
signals (`beta_signup`) dedup per-identifier — the rate limit is the flood
protection, the notification dedup shapes visibility, not security.

**Phase 3 — magic-link send, two limits both must pass: 8/hour per email
AND 20/hour per IP** (`903a9eb`), the last H1 endpoint. Three deliberate
owner decisions, all in the Decisions log: (1) **loud, not silent** — the
user sees "You've requested several sign-in links recently. Please wait a
few minutes and try again." on block, a departure from the allowlist
gate's silent-success pattern right beside it in the same function,
because this app has no password for "silently succeed" to protect and a
magic-link app failing silently is one of the worst UX patterns a small
app can have (the residual leak risk is negligible: both allowlisted and
non-allowlisted emails hit the identical limit and see the identical
message, so the block itself reveals nothing about allowlist membership);
(2) **8/hour**, chosen over 5 (too tight for legitimate resend behavior —
two attempts per link plus a couple of retries hits it fast) or 10
(looser than needed); (3) **admin notified on a block**, deduped
per-email/24h (same shape as `beta_signup`'s corrected dedup above), but
only when the affected email is allowlisted — an unknown email hammering
the limit is exactly the noise the existing `allowlist_rejection` path
already reports on, so a second alert would add nothing.

Two diagnostic findings shaped the implementation. First: threading the
client IP through `app/login/actions.ts` turned out to need no surgery at
all — Auth.js v5 already passes the raw `Request` object into
`sendVerificationRequest` (`EmailProviderSendVerificationRequestParams`
includes `request: Request`), so the IP is read the same
`x-vercel-forwarded-for` way as Phases 1-2, right where the rate limit
check already runs. Second, surfaced mid-implementation while adding
tests: importing `auth.ts` — or even bare `"next-auth"` — fails under
plain Node/vitest, because `next-auth`'s own entry point transitively
imports `next/server` (via `next-auth/lib/env.js`), which only resolves
inside Next.js's own bundler. Confirmed pre-existing (a bare `import
"next-auth"` fails identically outside this session's changes entirely),
not something this session introduced. Resolved by extracting the
rate-limit-plus-allowlist logic out of `auth.ts` into a new
`lib/magicLinkRateLimit.ts`, sourcing `AuthError` from `@auth/core/errors`
directly instead of via `"next-auth"` — confirmed via `next-auth`'s own
source (`export { AuthError, CredentialsSignin } from "@auth/core/errors"`)
to be the exact same class, just re-exported, so `instanceof` checks work
identically either way. This is the second session in a row a
test-environment gotcha has surfaced (the first was the Sidekick backfill's
mock-vs-real question) — logged as a Known Issue
(`vitest-nextauth-import-fragility`) rather than dismissed, with an
explicit "third instance graduates this to its own investigation" marker.

The block signal reaches the login form via a custom `AuthError` subclass,
`MagicLinkRateLimitError` — Auth.js's own supported extension point for a
sign-in provider to signal a specific failure — thrown in
`sendVerificationRequest` and caught in `app/login/actions.ts` ahead of
the generic `AuthError` branch. Not pre-approved verbatim in the original
task brief; judged not to be "meaningful surgery" (additive only, doesn't
touch session handling, the allowlist logic itself, or any other auth
path) and called out explicitly rather than done silently. No change
needed to `LoginForm.tsx` — its existing `state.error && <p>...</p>`
pattern already renders whatever string comes back generically. 13 new
tests: `__tests__/magicLinkRateLimit.test.ts` exercises the real
rate-limit and notification-dedup arithmetic through
`sendVerificationRequest` directly (not mocked) — 8/9 email boundary,
20/21 IP boundary, window rollover, admin-notify dedup and
allowlist-gating, key namespacing (`magic_link_email:`/`magic_link_ip:`,
distinct from `inbound:`/`beta_signup:`); `__tests__/loginActions.test.ts`
covers the `actions.ts` catch-block mapping (with `"next-auth"` itself
mocked, re-exporting the real `AuthError` class, since importing it for
real isn't viable under vitest either). 354 total tests passing, `npm run
build` clean. **Verified live 2026-07-16** via a normal sign-in through
the real login form.

`SECURITY_AUDIT.md` updated same-session (`903a9eb`): H1's own entry
marked ✅ resolved with all three endpoints and their limit values listed;
the coverage-matrix's three H1 cells updated from `⚠︎ H1` to `✓` with the
limit noted inline; the "Suggested order of work" list's H1 line marked
done.

---

## 2026-07-15 — sidekick-deadline-anchor-mismatch fixed: null anchor defaults to orderDate, shipping buffer tightened 7→5 (`72274c2`, owner-verified live)

Reported symptom: Sidekick order #SK213978 showed "Return by Aug 31, 2026" —
orderDate Jun 25 + a 60-day "from purchase" policy should be Aug 24, a 7-day
mismatch. Diagnostic-first pass (same-day, earlier session) found the original
hypothesis (`computeDeadline()` anchoring on a populated `estimatedDeliveryDate`)
didn't match prod: no delivery date existed anywhere on the order. Real cause:
the web-lookup extraction's own notes said the policy's anchor was genuinely
ambiguous ("does not explicitly state whether the 60 days runs from order date
or delivery date"), so `returnWindowStartsFrom` persisted `null` — and
`computeDeadline()` treated `null` identically to an explicit `delivery_date`
anchor, estimating a synthetic delivery date (orderDate + a shipping buffer)
before applying the window. A systemic scope check confirmed this was
contained to one order, not widespread, before any fix was written.

**Decision 1 — null/unknown anchor defaults to `orderDate` directly**, not a
delivery-plus-buffer guess. Rationale: order-date anchor is always <=
delivery-date anchor, so defaulting an unconfirmed anchor to orderDate can
never compute a deadline later than the true one could be — mirrors the
existing tiered-window "shortest window always wins" precedent ("a wrong
deadline is worse than a missing one"). `deadlineIsEstimated` stays `true` in
this branch even though `orderDate` is a real, confirmed value — the anchor
*choice* is still an assumption, not a fact the AI confirmed, which matches
this codebase's standing convention that `deadlineIsEstimated` flags
uncertainty in the calculation basis, not just the date's provenance (same
reasoning as why an `estimatedDeliveryDate`-anchored deadline is flagged
estimated despite using a real carrier ETA).

**Decision 2 — `STANDARD_SHIPPING_DAYS` tightened 7 → 5 days**, the buffer
used only when a policy is explicitly `delivery_date`-anchored but no real
delivery signal exists yet. Same "wrong deadline worse than missing"
principle: owner explicitly accepted that a user might occasionally start a
return a couple of days before they strictly needed to, in exchange for never
computing a deadline later than the real one.

Both changes scoped to `computeDeadline()` only — order-date-anchored orders
untouched, no extraction/prompt changes, `returnWindowStartsFrom`'s own
semantics untouched. 4 new tests (Sidekick's exact inputs, delivery-signal-
present override, no-orderDate fallback, null-with-no-signal) + 1 updated
regression guard for the buffer change, 321 total tests passing, `npm run
build` clean.

**Backfill** (`scripts/backfill-deadline-anchor-and-buffer.ts`, dry-run diff
printed and approved by the owner before `--apply`, refuses to write anything
if it finds a counterexample) updated 20 active orders: 19 delivery-date-
anchored orders tightened 2 days each (buffer change), Sidekick tightened 7
days (Aug 31 → Aug 24, anchor change). Every delta confirmed tightening before
writing, zero loosening. Two pre-apply sanity checks also cleared: (1) the
"21 vs 19" discrepancy against an earlier diagnostic — one order (Shopbop) was
delivery-date-anchored but already had a real `estimatedDeliveryDate`, so
unaffected by the buffer change by design; one order (Poshmark) had its
`displayStatus` change to `kept` between sessions, correctly dropping it from
the active-order scope; (2) re-verified no affected deadline landed on/before
the current date, no other `-7d` deltas besides Sidekick, no unexpected
retailers in the list.

Verified live via a disposable authenticated session (a manually-issued
`Session` row for the order's own owner, deleted immediately after use — no
real email sent, no magic-link flow triggered) — screenshot confirmed
"Return deadline: Aug 24, 2026" plus "Some dates on this order are estimated"
on the real production page. Owner hand-verified live in production
2026-07-15.

BUILD.md's stale `computeDeadline()` documentation block (still describing
pre-Milestone-15 logic) rewritten to match current behavior; the
corresponding Known Issues entry removed. One side observation surfaced
during verification, not fixed (out of this session's `computeDeadline()`-only
scope): the order detail page's `returnWindowFromLabel()` already defaulted a
null anchor to the label "from purchase," reading as more certain than the
data actually is for a genuinely-ambiguous-anchor order — promoted to
🔴 Now as `returnwindow-label-anchor-uncertainty` in a later session (the
visible follow-up to this fix, not backlog).

## 2026-07-15 — Inbound webhook Postmark hardening: rollout complete, HTTP Basic Auth activated

Code (flood alert + dormant Basic Auth check) shipped dormant on 2026-07-14
(`b2c7b4c`) — see the `07-14`-adjacent entry below for the build details
(`lib/inboundVolume.ts`'s atomic-`updateMany` counter, `isInboundWebhookAuthorized()`'s
constant-time comparison, the `"inbound_volume_spike"` notification kind). This
entry covers completing the rollout checklist (steps 2-6) end to end:

1. Generated a strong random password (`openssl rand -base64 24`), shown once
   to the owner for pasting into Postmark, not logged elsewhere in this
   session's artifacts.
2. Set `INBOUND_WEBHOOK_USER` (`postmark`) and `INBOUND_WEBHOOK_PASSWORD` in
   Vercel production via `npx vercel env add ... production` — confirmed both
   present via `vercel env ls production` before continuing.
3. Printed the exact webhook URL (`https://postmark:<password>@returns-assistant.vercel.app/api/inbound`,
   plus a percent-encoded fallback since the generated password happened to
   contain a `/`, which is a reserved character in URL userinfo). Owner
   updated the Postmark dashboard's inbound webhook URL and confirmed saved
   before any redeploy — this ordering (credentials live in Postmark while
   the check is still dormant) is what makes the rollout zero-lockout-risk.
4. Redeployed production via `npx vercel redeploy <deployment-id> --target production`
   rather than a `git push` (no code changed — this was purely to pick up the
   two new env vars, which only take effect on the next deploy per this
   project's standing convention). New deployment
   `dpl_m47vg2K7aSDJRywAWP8kUqbox1yb`, confirmed Ready and aliased to
   `app.myreturnwindow.com` and `returns-assistant.vercel.app`.
5. Verified live with two real `curl` POSTs against production: no
   credentials → `401 {"error":"Unauthorized"}`; correct credentials →
   `200 {"ok":true}`. Both matched expected behavior exactly — the inbound
   webhook is no longer open to anonymous POSTs, and the flood-alert half of
   this feature (dormant since it depends on real traffic volume, not
   env vars) is live alongside it.

No code changes this session — purely env var configuration + redeploy +
live verification. TASKS.md's rollout checklist is now fully closed out.
This also resolves security-audit finding C1 (inbound webhook open to
anonymous POSTs).

## 2026-07-15 — Gmail deep-link filter-setup button removed from Settings (owner-verified live)

2/2 non-owner test users (mom, brother) who used the deep link ended up with a
filter matching their entire inbox — real privacy exposure (personal email
forwarding into extraction). Surgical removal in `app/(app)/settings/page.tsx`:
deleted the `GMAIL_COMMERCE_QUERY`/`gmailSearchUrl` construction and the
deep-link `<a>` button + its instructional paragraph. "Your forwarding address"
card otherwise untouched (heading, intro paragraph, address+Copy row all render
exactly as before); `GmailVerificationCode`, Archived orders, and
Delete-all-data cards untouched. No manual-instructions replacement — the
owner's call was that we're removing the trap, not rebuilding the flow. No
backend/URL-construction changes; no change to any existing user's
already-created filter. Note: there is no separate new-user-onboarding route in
this codebase — Settings is the one shared page every user (new or existing)
sees, so this change is necessarily visible to everyone who opens Settings
going forward, not just new signups. 298 tests passing (no test referenced the
removed code), `npm run build` clean, verified live in a real browser
(disposable session, deleted after use) at commit time — card rendered
cleanly, zero console errors. Committed (`3658947`), pushed, auto-deployed
(`dpl_FMKqbrZRTsLSv99tRctnq62i7oLJ`, confirmed Ready and aliased to
`app.myreturnwindow.com` within ~3s of push — 6th data point on the
now-resolved auto-deploy question). **Owner hand-verified live in production
2026-07-15**, confirmed gone from Settings.

## 2026-07-10 (later) — Session close: Mark kept, auto-archive, Mark returned, and HTML emails all shipped and verified

Four features built and deployed in one continuous session, each gated behind its
own commit, its own test pass, and (where possible) real hands-on verification
before moving on — no bundling.

**"Mark kept" — new one-way `displayStatus`, dashboard-only.** Spec'd earlier the
same day (see the `07-10` entry above this one), built same session:
`Order.keptAt` + migration (`20260710213509_add_kept_at_to_order`); `kept` ranked
tied with `returned` (not above `refunded`) in `lib/displayStatus.ts` — the one
choice that made both existing rank-gates (`PATCH /api/orders/:id/status`,
`advanceDisplayStatus`) enforce "reachable from ordered/shipped/return_requested
only" for free, no bespoke branching; `deriveDisplayStatus()` gained an explicit
guard (`if (currentDisplayStatus === "kept") return "kept";`) since its refund-email
branch is deliberately exempt from the normal downgrade protection and would
otherwise let a stray refund email silently overwrite a manual kept decision.
"I'm keeping this" button shipped on all three order-list surfaces — dashboard
card view, dashboard table/list view (added second, same commit, per an explicit
product decision now in the Decisions log: list view is the primary surface for
routine actions, not just wherever a prior button happened to exist), and order
detail page — with an inline warning caption instead of a blocking confirm dialog,
and a visibility gate that hides once the return window is confirmed past while
treating a null deadline as still-open. Pushed (`01189f8`), auto-deployed. **Still
awaiting owner browser verification** — the one feature this session with no
click-through confirmation yet, since it wasn't the target of this session's live
tests.

**Auto-archive after missed window.** Nightly, silent sweep (no email/Reminder/
ActionLog row) for orders 14+ days past `returnDeadline`, scoped to
`ordered`/`shipped`/`return_requested` — `returned` deliberately excluded (already
user-acted, tracked by refund check-in separately). New `lib/autoArchive.ts`,
piggybacked onto the existing daily `/api/cron` run rather than a new scheduled
route. Pushed (`a7af7df`), auto-deployed. A pre-push read-only query found 0
currently-eligible orders — the feature is dormant on arrival, which was expected
and is why it was built second, after "Mark kept" (verifiable same-day) rather than
first.

**"Mark returned" — second one-tap-from-email action, proving the token
infrastructure is actually generic.** Built following Archive's exact pattern
end-to-end: `lib/actionToken.ts` and `lib/actionLinks.ts` needed zero changes.
`lib/returnedAction.ts`/`returnedPageState.ts` mirror `archiveAction.ts`/
`archivePageState.ts`, with one deliberate departure — Archive's gate is
idempotent (re-archiving is a harmless no-op), but "returned" is a forward-only
rank position like every other manual transition, so the gate reuses
`DISPLAY_STATUS_RANK` and rejects (as `order_state_changed`) an order already at
returned/refunded/kept. `POST /api/action/returned` writes via the existing
`buildStatusTransitionData("returned", ...)`, so it can't drift from the other
three write paths. Link added to both the deadline reminder and weekly digest,
same placement as Archive. 27 new tests. Pushed (`ae360be`) alongside HTML emails
below (same deploy — `git push` isn't selective, flagged to the owner before
pushing since only the HTML-email commit had just been reviewed).

**HTML emails — real hyperlinks instead of raw URLs, all three link-bearing
emails.** No HTML-email pattern existed anywhere in the codebase before this;
`lib/postmark.ts`'s `sendEmail()` was text-only. New `htmlBody` param (always sent
alongside `textBody`, never replacing it) plus a new shared `lib/emailHtml.ts`
(`escapeHtml()`, `htmlLink()`, `wrapEmailHtml()`). Applied to the deadline
reminder, weekly digest, and refund check-in in the same commit — deliberately,
per the owner's own reasoning: the shared infra only needed building once, and
leaving two of three emails with raw URLs after fixing the third would have been a
worse, inconsistent state than not starting. 23 new tests. Pushed (`cd786da`),
auto-deployed (`dpl_9WzYq7iHfsir6yScZjjQTSC4xAtK`).

Also investigated (no code change) a reported "coverage-check email shows entire
order history" symptom — the 7-day filter already existed and worked correctly;
real data showed two alpha accounts (jsweazey, kathleensweazey) simply have 100%
of their data within the last 7 days because the accounts are only ~2 days old.
Logged in Known Issues as resolved/non-issue so it isn't re-investigated.

**Live verification, real send.** Rather than stopping at unit tests, forced two
real reminder emails to the owner's own account (scoped, single-order, ownership
verified before each send, dry-run previewed before every real send, disposable
Reminder-row side effects accepted as real production state — not reimplemented
sends). First: On (On-Running) #101130827062601745, sent *before* the Mark-returned
deploy specifically to prove the "broken link" risk was real (confirmed: the
Mark-returned link 404'd as predicted, Archive link worked). Second, after both
features deployed: Shopbop #142770152 — owner confirmed the HTML rendered
correctly and all three links resolved, then clicked "Mark as returned" for real.
Confirmed via direct read that the transition landed exactly as expected
(`displayStatus: shipped → returned`, `returnedAt` set), then reverted it (direct
DB write scoped to this one order — `displayStatus` back to `shipped`, `returnedAt`
back to `null` — since the app has no "unmark returned" path by design; one-way
rank-gated transitions don't get a UI undo). Owner confirmed both HTML emails and
Mark returned as verified based on this test. Also answered a side question during
this pass: the order that originally surfaced the "estimated delivery dates
presented as confirmed" bug (04e9675) was Proenza Schouler #86864's
`shipping_confirmation` email "Your shipment is on the way 873765217005" (received
2026-06-30, extracted a shipping ETA of 2026-07-07 into the then-unsplit
`deliveryDate` field the day before the actual delivery landed).

All four features' commits, tests, and doc updates (`BUILD.md`/`TASKS.md` in the
same commit as their code, per the standing rule) are pushed and live. `main` and
`origin/main` match; no unpushed commits at session close.

---

## 2026-07-10 — orderDate-fallback Phase 4 backfill: 5 pre-gate wrong-fires corrected, Upway excluded

Closed the excluded-side verification deferred from Phase 2 (`76f4dd6`): backfilled
the prod rows where `applyFallbackOrderDate` had fired before the gate existed, with
an earliest-linked emailType now on the excluded list (`return_label`/`refund`/`other`).

Diagnostic-first, read-only pass first: re-querying for the pattern (orderDateEstimated:
true AND earliest-linked emailType in the excluded set) found **6** rows, not the 5
logged from Phase 1. The 6th, Upway US #US8855, is the same row already tracked
separately in Known Issues as an `other`-emailType misclassification — its Decisions-log
entry says directly: "the 1 anomaly (Upway) is a classification bug tracked separately,
not a case for gate special-casing." Nulling its `orderDate` would have masked that
misclassification rather than fixed a gate wrong-fire, so it was excluded and left
untouched — verified unchanged post-backfill (`orderDate: 2026-07-09T15:48:38.000Z`,
`orderDateEstimated: true`, `returnDeadline: 2026-07-30T15:48:38.000Z` — identical to
its pre-backfill state).

The remaining 5 were backfilled — `orderDate` and `orderDateEstimated` → `null`/`false`,
`returnDeadline` and `deadlineIsEstimated` recomputed via the real `computeDeadline()`
(not hand-written). None had a `deliveredAt` or `estimatedDeliveryDate` to fall back on,
so `returnDeadline` cascades to `null` in every case — the current deadlines were
fabricated from an unrelated return/refund email's `receivedAt`, and no deadline is more
honest than an invented one.

| Retailer / Order | earliest emailType | orderDate before → after | returnDeadline before → after |
|---|---|---|---|
| Mango #F4VLSG00 | return_label | 2026-07-08 → null | 2026-08-07 → null |
| Moda Operandi #456603272478 | return_label | 2026-07-07 → null | 2026-07-28 → null |
| Gap Inc. #1R1KXD3 | return_label | 2026-07-08 → null | 2026-08-14 → null |
| Lola Blankets #1158308 | refund | 2026-07-03 → null | 2026-07-24 → null |
| Shopbop (no order number) | refund | 2026-07-02 → null | 2026-08-08 → null |

This table is the excluded-side verification Phase 2 deferred — confirms a
`return_label`/`refund`-first order correctly loses its fabricated `orderDate` rather
than keeping one, closing the loop opened in the 2026-07-09 entry below.

Silent correction, no user notification — same test applied as Caroline's Moda backfill:
all 5 orders are `return_requested` (return already shipped) or `refunded` (already
archived), so losing the deadline affects no future reminder or user action. Re-read
all 5 rows immediately before writing to confirm none had drifted since the dry-run
review; none had. One-off diagnostic and backfill scripts both deleted after use per
project convention.

Surfaced two new 🟡 Next items during this session: a Gap Inc./Old Navy brand-family
identity question (Gap #1R1KXD3 surfaced under Old Navy — same shape as the Amazon
first-class-case question), and a Shopbop refund-matching improvement (goods/line-item
description as a second signal alongside retailer + amount + recency, for refund emails
with no order number).

---

## 2026-07-09 — Session close: CLAUDE.md canonicalized, orderDate-fallback gate shipped, Gmail deep-link bug escalated

Closed the drift risk between two overlapping-but-different sources of truth
for standing working habits: CLAUDE.md's repo-level "Working agreement" and
the memory-system's `feedback_standing_habits.md`. CLAUDE.md is now
canonical (new "Behavioral habits" section); the memory file is a pointer
back to it (`9ebe8dc`, pushed).

Shipped Phase 2 of the orderDate-fallback emailType gate
(`orderDate-fallback-emailtype-gate`): `applyFallbackOrderDate` in
`lib/linkOrder.ts` now fires only when the earliest-linked email is
`order_confirmation`, `shipping_confirmation`, or `delivery` — `return_label`,
`refund`, and `other`-typed earliest emails leave `orderDate` null instead of
inheriting an unrelated `receivedAt`. Two diagnostic-first passes (Phase 1,
then a targeted `other`-bucket sample) caught two real issues before any code
shipped: the originally-assumed `return_received` emailType doesn't exist in
this codebase (real set is six values, not seven), and one `other`-typed prod
row was a likely transactional-email misclassification (tracked separately,
not folded into the gate). Committed (`76f4dd6`), pushed, deployed
(`dpl_5mopRwrpkD6nh8PyPyKHRnMBJ8aE`), 8 new tests (199 total passing).
Owner-verified on both paths post-deploy: a fresh Amazon order_confirmation
forward correctly triggered the fallback (`orderDate` set from `receivedAt`,
`orderDateEstimated: true`); a fresh J.Crew order_confirmation with its own
extracted `orderDate` correctly early-returned, confirming no regression on
the working case. Excluded-side verification (a `return_label`/`refund`-first
order staying `orderDate: null`) deferred to the Phase 4 backfill of the 5
affected prod rows found in Phase 1 (0 of which are currently
trust-erosion-visible — no past-due deadlines among them).

Spent significant morning time on a Gmail deep-link bug: the commerce-query
deep link, byte-identical to the owner's own working link, loads with
essentially no search applied when opened from a second real account (the
owner's mother's), returning close to the full inbox instead of a filtered
set. Not a "user followed instructions wrong" case. Root cause unresolved —
debugging is high-cost without browser instrumentation access. Escalated to
tomorrow: reproduce on a third account to determine whether this is
per-account or systemic, with real evidence now supporting prioritizing
OAuth-based setup over the deep-link approach. Interim workaround: manual/text
setup instructions bypassing the deep link.

Auto-emailing the Gmail confirmation code did **not** ship today — the spec
pass was deliberately deferred because the deep-link discovery raised
broader questions about setup UX that should be answered first, rather than
spec'ing the email-code feature in isolation.

Surfaced eight new 🟡 Next items and three ⚠️ Known Issues items from today's
diagnostic work and real user testing (an Amazon order test, a J.Crew order
test, and the Gmail deep-link reproduction): Phase 3+4 of the orderDate-fallback
work, the Gmail deep-link bug itself, delivery-date surfacing as a possible
first-class dashboard feature, final-sale/non-returnable item handling
(surfaced by a J.Crew order with enumerated return exclusions), and an admin
dashboard panel that conflates AI-extraction values with final Order state
(source of today's own Phase 2 verification confusion, caught and corrected
mid-session).

---

## 2026-07-08 — Session close: one live bug fixed, four ships, one user-research pass

Closed one live production reliability bug: A1's tiered-window `needsReview`
detection was a case-sensitive string match on AI notes output, and
non-deterministic AI capitalization defeated it on a real re-extraction of
Caroline's Moda email (`needsReview: false` when it should have been `true`).
Fixed same-day by promoting `needsReview` to a first-class AI-set JSON schema
field (A1 Phase 2, `74507b4`), with the string-match retained as an OR'd
fallback for one release cycle rather than deleted outright.

Four things shipped today: the Gmail deep-link query swap on the setup page
(`730fc36`), admin dashboard v1 and v1.1 (`b498a08`, `ab290a5`), and the A1
tiered-return-window prompt rule across both its phases (`1216aaf`,
`74507b4`). One live user-data correction executed cleanly: Caroline's Moda
Order backfilled under the corrected A1 Phase 2 extraction rules (see the
dedicated diagnostic-first entry below), with the same disposable-script
discipline as every other backfill this project has run — verify before
writing, dry-run before commit, delete the script after use.

One user-research pass completed: walked all four alpha dashboards, surfacing
two real extraction-quality bugs with clean diagnosis on both (Moda's tiered
policy, WNU's possibly-hallucinated source attribution) and evidence for
three real 🟡 Next candidates — the retailer policy database, the
tiered-policies schema work, and `orderDate`-fallback's missing `emailType`
gate.

Discipline held throughout: every ship went through diagnostic-first
investigation before code, stayed scoped to what was asked, and nothing was
marked ✅ in `TASKS.md` before the owner hand-verified it in production. Two
things deliberately deferred rather than rushed: auto-emailing the Gmail
confirmation code (needs its own spec pass, not a bolt-on), and both the
retailer policy database and tiered-policies schema work (each needs its own
session, not squeezed in after other work).

---

## 2026-07-08 — Admin notification persistence + two silent signup gaps closed

Surfaced diagnosing a friend's beta signup that reached the DB (`BetaSignup` row
present, correctly timestamped) but never notified the owner. Root-caused before
touching anything: `app/api/beta-signup/route.ts` was confirmed to call and
`await notifyAdmin(...)` correctly — not a fire-and-forget bug. Both `ADMIN_EMAIL`
and `REMINDER_FROM_EMAIL` were confirmed configured in production. That left
`notifyAdmin`'s own contract as the likely failure point: it wraps `sendEmail` in a
try/catch that only `console.error`s on failure, by design ("never let a
notification failure break the real flow it's attached to") — but on Vercel that
log line is ephemeral and unrecoverable after the fact, so a genuine Postmark-side
hiccup would have left zero durable trace anywhere. Vercel's log CLI only streams
recent/live activity (no drain configured), so the original failure reason was
unrecoverable this time — motivating the fix below rather than further digging.

**Fix 1 — `AdminNotification` persistence (`fdd851e`).** New table: `kind`,
`subject`, `body`, `relatedEmail`, `deliveryStatus` (`sent` | `failed` |
`skipped_not_configured` | `deduped`), `errorMessage` (populated on `failed`),
`attemptedAt`. `deliveryStatus` kept as a plain `String`, not a Prisma enum —
cheap to extend as new kinds/statuses show up during alpha. `notifyAdmin` now
writes a row on every call, regardless of branch (missing-config skip, send
success, send failure) — a swallowed failure now has a durable, queryable trace
instead of only a log line. All 5 existing call sites (beta signup, Gmail
forwarding verification, reminder/weekly-coverage/weekly-digest cron summaries)
updated to pass a `kind`.

**Fix 2 — allowlist-rejection notify (`fdd851e`, same commit).** `auth.ts`'s
`sendVerificationRequest` previously handled an unallowlisted email by silently
`return`ing — correct as an auth decision (the gate itself was working exactly as
designed), but invisible: a friend trying to log in before being allowlisted would
vanish without a trace anywhere. Now fires `notifyAdmin(..., "allowlist_rejection",
email)` on rejection. Deliberately deduped per email per 24h (`hasRecentNotification`)
rather than a global rate limit — `/login` is a public, unauthenticated,
guessable surface, and a bot cycling the same address repeatedly shouldn't spam the
owner's inbox. The dedup guard still writes a row (`recordDedupedNotification`,
`deliveryStatus: "deduped"`) rather than silently dropping the attempt, so a
pattern of many deduped rows for one email remains visible evidence of
scanning/bot activity even though only the first real attempt actually emailed. A
global rate limit (guarding against a bot cycling many distinct emails, a
different attack shape) was deliberately not built — nothing suggests that
pattern at pre-beta scale; add it if the table ever shows it.

**Fix 3 — auth-flow signup notify (`fdd851e`, same commit).** New `User` rows
created via the login flow previously triggered no admin notification at all —
the only signal was a `bcc: ADMIN_EMAIL` on the magic-link email itself, which (a)
reads as a normal login email, not a "new signup" signal, and (b) wouldn't fire at
all for a gated-out email, same blind spot as Fix 2. Rather than inferring "is this
a new signup" inside `sendVerificationRequest` (which fires before anything is
confirmed), wired into Auth.js's `events.createUser` hook — fires exactly once,
precisely when the Prisma adapter creates the row. Same notify shape as beta
signup (`kind: "new_user_login"`).

**Design decisions:**
- One `AdminNotification` table, not a separate log-only table plus a
  notification table — every proposed use case wants "log this AND notify" as one
  atomic pair; a log-without-notify table would have had zero real callers.
- `attemptedAt`, not `sentAt`, as the timestamp field name — a row with
  `deliveryStatus: "failed"` and a field literally called `sentAt` would read
  contradictorily.
- Unified through the existing `notifyAdmin` signature (added a required `kind`
  param and an optional `relatedEmail`) rather than introducing a second
  `notifyAdminOfEvent`-style wrapper — `notifyAdmin` already was the one
  call-through point every notification used; deepening its contract keeps that
  true instead of creating a second name to remember.

**Verified (owner, production):** a one-off retry script (`scripts/
retry-lauren-notify.ts`, deleted after use per this project's established
one-off-script discipline) re-fired the original missed notification through the
new persisted path — it landed in the owner's inbox this time, and its
`AdminNotification` row showed `deliveryStatus: "sent"`, pointing to a transient
Postmark-side hiccup on the original attempt rather than a config or code bug. A
second friend's real login attempt, made before being allowlisted, correctly
triggered the rejection notify. A fresh beta signup through the real marketing-page
form produced both the `BetaSignup` row and the admin notification end to end.
Full suite (181 tests) green, build clean throughout — no test coverage existed
for `notifyAdmin` before or after (still DB-touching, not a pure-function unit;
consistent with this project's existing testing philosophy).

---

## 2026-07-06/07 — Signed action tokens, Phases 1–5 (Archive-from-email slice)

First real slice of the one-tap-from-email spec (Section A/B, drafted 2026-07-04):
shared signed-token infrastructure plus one action (Archive) built end-to-end.
`kept` and every other action (Mark returned, Mark refunded, Mark kept, Unarchive)
are deliberately out of scope — separate future sessions. Phased into 4 commits so
far, each independently reviewed and verified before the next started.

**Phase 1 — token core (`1517139`).** `lib/actionToken.ts`: `signToken`/`verifyToken`,
HMAC-SHA256, base64url, `crypto.timingSafeEqual` for signature comparison (length
checked first — `timingSafeEqual` throws on a length mismatch rather than returning
false, so a truncated signature routes to the same "invalid" outcome without ever
skipping the constant-time comparison for well-formed input). `ACTION_TOKEN_TTL_DAYS
= 14`, exported so later phases reference the same constant. `instrumentation.ts`:
Next.js's boot hook, refuses to start if `TOKEN_SIGNING_SECRET` is missing or under
32 bytes. Deployed only after independently confirming the secret was set in all 3
Vercel environments — deploying the boot check first would have crashed the entire
app on next cold start, not just token features.

**Phase 2 — data model (`265e030`).** `TokenRedemption` (tokenHash unique, action,
orderId, redeemedAt) and `ActionLog` (userId, orderId, action, outcome, ipAddress,
userAgent, at) migrations, both nullable-FK + `SetNull` on delete matching
`Reminder`'s existing pattern — a hard-deleted Order shouldn't block on or erase
these audit trails. `lib/actionLinks.ts`'s `buildActionLink()` issuance helper.
Also fixed `vitest.config.ts` to resolve the `@/` path alias (present in tsconfig,
absent from Vitest) so a real integration test between `actionLinks` and
`actionToken` didn't need to mock a two-line pure function for no reason. Migration
confirmed against production Neon: 0 rows in both new tables, existing Order data
(23 rows) untouched.

**Phase 3 — Archive redemption endpoint (`1c4261b`, polish `8a093aa`).**
`POST /api/action/archive`: verifies the signed token, verifies a per-page CSRF
token derived from it (`signCsrfToken`/`verifyCsrfToken`, HMAC over the action
token itself — no separate storage or expiry needed), enforces single-use via
`TokenRedemption.tokenHash`'s unique constraint (an atomic DB-level guarantee, not
a check-then-write race — the insert happens first specifically so two concurrent
requests for the same token race on it), and checks `Order.userId === token.userId`
as a backstop against internal bugs, not just attackers. `TokenRedemption` +
`Order.update` (when applicable) + `ActionLog` all commit in one transaction — no
audit gap between them. IP captured via `x-vercel-forwarded-for` (Vercel's edge
sets this itself; unlike `x-forwarded-for` it can't be altered by an intermediate
rewrite). The already-used path writes its `ActionLog` row outside the (rolled-back)
transaction — the only place that can happen — with one retry + a console fallback
so a transient blip can't leave a silent audit gap for a real second-tap attempt.

Found and fixed while wiring up this first real caller: Phase 1's `verifyToken`
signature required an `expected.orderId` to check against, but the real link shape
(`/action/{action}?token=...`) never carries an independent orderId for a caller to
compare — the one-order scoping is already structural (the endpoint only ever acts
on `payload.orderId`). Dropped `orderId` from `expected`; the `expired` branch of
`VerifyResult` now also carries the decoded payload, since the signature already
checked out by the time expiry is the only problem.

Polish (`8a093aa`): `order_state_changed` and the userId-mismatch `invalid` outcome
now return 422 instead of 200 — well-formed request, business rules blocked it —
so monitoring can distinguish business-rejected from successful without parsing the
body. The `outcome` field, not the status code, stayed the source of truth Phase 4
branches on.

Verified live against production with disposable test orders (created and deleted
after each check, not real user data): fresh archive → `success`, `archivedAt` set,
1 `TokenRedemption` + 1 `ActionLog(success)` row; re-submit same token →
`already_used` (409), no new `TokenRedemption` row; tampered CSRF → `invalid` (403);
backdated-15-day token → `expired` (410); token for a soft-deleted order →
`order_state_changed` (422 after the polish).

**Phase 4 — confirmation page + failure-mode pages (`6dcba62`, amended `6235a6b`).**
`app/action/archive/page.tsx`: GET renders the confirmation form or the matching
failure page. Read-only by construction — calls `verifyToken` (necessary for this
page's own render decision, not a re-verification of anything Phase 3 already did)
plus two read-only lookups (`TokenRedemption` existence, `Order` state), never
writes `TokenRedemption` or `ActionLog`. `lib/archivePageState.ts`'s
`decideArchivePageState()` mirrors Phase 3's `decideArchiveOutcome` for the
pre-POST view, unit-tested including the expired-with-payload case specifically
(confirms the function actually reads `payload.issuedAt` to compute the expiry
date, rather than treating `expired` as payload-less). `app/action/archive/done/
page.tsx`: outcome → copy, no DB access — accepted tradeoff, the `?outcome=` param
isn't signed, so a hand-built URL can show success copy without anything having
been archived; not a security issue (no state changes happen from viewing this
page), and signing it would be over-engineering for a purely display concern.

The POST route's response construction changed from JSON to a 303 redirect
(Post/Redirect/Get, so a refresh never resubmits the POST) — per the
response-format-only rule agreed before this phase started, the transaction, the
decision logic, and CSRF/signature verification are all unchanged. The elaborate
200/422/410/403/409 status codes designed for the raw JSON API in Phase 3 collapse
to a uniform 303 here, since a real browser form-submit expects a redirect
regardless of outcome — outcome signaling now lives entirely in the query param +
done page's copy.

**Amendment, found on the owner's first browser pass:** the confirmation page was
too thin — asking the user to archive an order without showing what it was. Fixed
using data the page was already fetching (no new DB calls, no new writes, no
re-verification): confirm page now shows retailer (prominent), order number,
total, order date, return deadline with days remaining, current `displayStatus`
badge, and a "View in app" link to the order detail page (new tab).
`already_used`/`order_state_changed` failure states also now show retailer + order
number so the user knows which order the message refers to (`order_state_changed`
shows them too when the row still exists but is soft-deleted). `expired`/`invalid`
stay minimal — the token's semantic meaning is limited there, and for the
userId-mismatch `invalid` case specifically, showing order details would leak
information about an order that isn't this token's.

**Verified — two rounds.** Curl pass (disposable test orders, cleaned up after):
confirm page HTML shape, form `action`/`method`, hidden `token`/`csrf` fields,
303 redirect `Location` header, done-page copy for all 5 outcomes. Owner's browser
pass (desktop + mobile, real click-through) on the amended version: enriched
fields present and legible, "View in app" opens the order detail in a new tab
correctly, already-used page shows retailer/order number matching the amendment.

**GET-safety re-verified explicitly**, since the amendment added more read-only DB
lookups to the GET path and that's exactly the kind of change that could
accidentally turn a page view into a redemption attempt: a fresh test order's
confirmation page (Claude via curl, 3 reloads; owner in-browser, 3–4 reloads) held
at zero `ActionLog` rows and zero `TokenRedemption` rows throughout — confirmed
directly against the DB after the fact, not just by absence of errors. The
before/after single-click comparison (one `ActionLog(success)` row appearing only
once "Archive this order" is actually submitted) was independently confirmed on a
separate test order from earlier in the same session — cross-checked row counts
and timestamps to rule out a stray redemption before writing this down. Confirms
the read-only guarantee held through the amendment, not just at
initial Phase 4 ship.

**Owner-verified in production — Phase 4 done.**

**Phase 5 — wire into reminder + Sunday digest templates (`fa42d99`).**
`app/api/cron/route.ts`'s `buildBody()` and `app/api/cron/weekly-digest/route.ts`'s
`buildOrderLine()`/`buildBody()` all now append an Archive link via
`buildActionLink()`, alongside the existing "View details" dashboard link.
`userId` threaded through both — already in scope at each call site (the reminder
cron already used `order.userId` for its `Reminder.create` call two lines below;
the digest already loops per-user and calls `buildBody` once per send).
`buildSubject`/`buildBody` (cron route) and `buildOrderLine`/`buildBody`/
`DigestOrder` (digest route) exported — pure export-keyword additions, no
restructuring — so both are directly unit-tested and reusable by a verification
script without duplicating the logic.

**No live sends to alpha users this phase**, deliberately. `?force=true` on either
cron endpoint loops over every user's every eligible order — checked before doing
anything and found the real risk was concrete, not theoretical: 18 eligible orders
existed across Susan/Caroline/Alexandra/owner at verification time, and
`nearestReminderType()` maps *any* future deadline to the closest threshold
(0/1/2/7 days), not just orders exactly N days out, so force-firing either
endpoint unscoped would very likely have emailed other real users. No per-user
scoping param exists on either route, and adding one was considered and explicitly
declined in favor of a safer approach: a one-off script
(`scripts/phase5-verify-reminder.ts`, deleted after use) that imported the real
exported `buildSubject`/`buildBody` and called `sendEmail` directly for one
disposable test order (2-day-out deadline, matching the `2_day` reminder cadence),
bypassing the shared multi-user endpoints entirely. Same real code path as
production, zero risk to any other user's inbox.

Verified: sent to the owner's real inbox, subject "2 days left to return: Phase 5
Reminder Test · $38.00", body included both the dashboard link and the new
Archive link. Owner clicked through from the real email; confirmed after: order
`archivedAt` set, 1 `TokenRedemption` row, 1 `ActionLog(success)` row. Test order
and verification script deleted after confirmation.

**All five phases shipped in this session, deployed after each one, with zero
rollbacks.** Every phase was curl- and/or browser-verified against production
before moving to the next, and the one amendment needed (Phase 4's order-context
enrichment) was caught by the owner's own browser pass and fixed forward in the
same phase rather than requiring a revert. Caroline/Jennifer/Susan/kathleen/
alexandra/lesleydunc will get the Archive button naturally on their own next real
reminder or digest — the actual production behavior this slice exists to
validate, not something that needed a forced send to prove.

---

## 2026-07-06 — Weekly digest: Jul 5 silent fire diagnosed, make-up digest sent

**Weekly digest — Jul 5 scheduled cron did not fire; cause not conclusively
identified.** Code inspection found no material difference from the working Friday
`weekly_coverage_check` cron (identical `GET` handler, identical `CRON_SECRET` auth,
identical await ordering, identical unfiltered user query — direct diff, not
assumption). Deployment confirmed live since Jul 1 (the commit adding the digest cron,
`92be597`, landed in a production deployment at 2026-07-01T22:26:10 UTC, well before
Jul 5's scheduled 16:00 UTC fire) — so this wasn't a case of the cron never having been
registered. Vercel's log retention didn't reach back far enough (via CLI) to see the
actual Jul 5 invocation attempt directly.

**Weekly digest — Jul 5 scheduled cron did not fire; cause not conclusively
identified. Code inspection found no material difference from working Friday cron;
deployment confirmed live since Jul 1. Jul 6 make-up digest force-sent successfully to
owner + 3 alpha users; Jul 12 will be first real scheduled fire since Jul 5.**

Full detail: `GET /api/cron/weekly-digest?force=true` returned `200`, all 7 users
`sent` (0 failed, 0 skipped) — owner (Step 1, confirmed received in inbox) and the
3 alpha users Caroline/Jennifer/Susan (Step 2) all included in that single invocation.
Per-user outcome for the 3 alpha users: all three got the zero-orders fallback content
("Nothing due this week — you're all caught up"), not a real itemized digest — none of
the three currently have any order with a `returnDeadline` in the next 7 days. All
three sends succeeded (no errors, no skips). 7 new `weekly_digest` Reminder rows
confirmed written in the DB immediately after the call. Confirms the route itself
works correctly end-to-end as currently deployed.

Jul 12 will be the first real scheduled fire since Jul 5. See TASKS.md 🟡 Next for the
follow-up watch item.

---

## 2026-07-05 — Bugs 9+10+11: refund-amount-aware status branching + linkOrder fallback (`b91354f`)

**Design shift — explicit:** BUILD.md's original rule was "refunded is never
auto-derived" — only a manual "Mark as refunded" click could reach that status. This is
now superseded. Retailer refund emails turned out to be inconsistent about what they
actually confirm: "your refund is processed" often means "we received your package" or
"we started the refund," not "the money is in your account." Since catching exactly that
kind of vagueness is the product's reason to exist, treating every refund email as
equally trustworthy would have been the wrong call. The new rule branches on whether the
email states a *confirmed* dollar amount:
- **Confirmed amount** (e.g. Shopbop's "$123.05" stated as the refund total) → advances
  straight to `"refunded"` — chapter closed, auto-archives, no further reminders.
- **No confirmed amount** (e.g. H&M's "we're processing your refund," no dollar figure
  anywhere in the body) → advances only to `"returned"` — deliberately **not**
  archived, so the pre-existing refund check-in reminder (cron-driven off
  `displayStatus === "returned"`, unchanged) naturally nudges the user later to verify
  the money actually landed. No new "scheduling" code was needed for this — the
  check-in cron's own query already covers it once an order lands in this state.

**Problem, three symptoms of the same root cause:** Lola Blankets was linked correctly
but stuck at `displayStatus: "ordered"` despite having a refund email — `deriveDisplayStatus()`
had no case for `refund` emailType at all. Shopbop and H&M refund emails were orphaned
(`orderId: null`) because their bodies had no order number, and the linking gate required
one unconditionally for every email type.

**Diagnosis, done before any code was written** (`scripts/diagnose-refund-orphans.mjs`,
read-only against production): the H&M refund email had no `lineItems`/`orderTotal`
either — a generic "how your refund method works" email with zero itemized signal — but
exactly one existing H&M order for that retailer. Shopbop's refund email had a real
`orderTotal` ($123.05) and `lineItems`, but there was no existing Shopbop order at all —
checked and ruled out a retailer-name-mismatch theory against the known duplicate
"On (On-Running)" order rows first (`scripts/diagnose-shopbop-on.mjs`) — the original
purchase confirmation for this Shopbop order was simply never forwarded.

**What changed:**
- `lib/extract.ts`: new `refundAmount`/`refundAmountConfidence` extraction fields,
  distinct from `orderTotal` — only set when a dollar figure is unambiguously labeled as
  the refund/credit amount; the prompt explicitly forbids reusing `orderTotal` as a
  stand-in. New `Email.refundAmount`/`refundAmountConfidence` columns (migration
  `20260705154212_add_refund_amount`); `runExtraction.ts` persists them.
- `lib/displayStatus.ts`: `deriveDisplayStatus()` takes a new `hasConfirmedRefundAmount`
  param — a `refund` emailType now routes to `"refunded"` or `"returned"` depending on
  it, checked *before* the return_requested-or-higher early-return that gates the rest
  of the ladder (a refund email is the one auto-derivation signal allowed to move an
  order past that point on its own; the final rank comparison, not the early-return,
  still protects against downgrade in both branches). `buildStatusTransitionData()`
  generalized to backfill `returnedAt` on the direct-to-`"refunded"` jump too, not just
  `"returned"` — needed since these orders can now skip `"returned"` entirely, unlike
  the two manual endpoints which always gate `"refunded"` behind an existing `"returned"`
  status first.
- `lib/linkOrder.ts`: `recomputeDisplayStatus()` now queries `refundAmount`/
  `refundAmountConfidence` alongside `emailType`, computes the confirmed-amount flag
  across all linked refund emails, and switches to building its update via the shared
  `buildStatusTransitionData()` (a third caller, alongside both manual endpoints) instead
  of its own ad-hoc object — this is what makes auto-archive apply on the refunded branch
  and *not* apply on the returned branch, for free, with no duplicated logic.
- `lib/linkOrder.ts`: new `findRefundFallbackOrder()` — scoped strictly to
  `emailType === "refund"` with a missing `orderNumber` (does not loosen the
  `orderNumber` requirement for any other email type). Tiered, most specific first: (1)
  line-item name overlap against candidate orders for the same retailer, (2) `orderTotal`
  soft match (loose `<=`, not exact equality — refunds are frequently partial), (3)
  recency (the retailer's only order, or its most recently created one). Every fallback
  match sets `needsReview: true` + a `userNote` audit line, matching the existing
  retailer-prefix-match convention. When there's no candidate order for that retailer at
  all, falls through to `createOrderFromEmail()` (unmodified) rather than leaving the
  email permanently orphaned.
- BUILD.md updated in the same commit: Email-first principle section, the `displayStatus`
  behavioral-rules section, and the Order linking section all describe the new rule.
- 14 new tests in `__tests__/displayStatus.test.ts`: the refund branching (confirmed vs.
  no-confirmed-amount, from every starting rank, no-downgrade in both directions, a
  refund email evaluated alongside other signals) and `buildStatusTransitionData()`'s
  `returnedAt` backfill on the direct-to-refunded jump.

**Backfill** (`scripts/backfill-refund-status.ts`, dry-run reviewed and confirmed before
`--apply`) — reused the existing, already-tested `runExtraction()` directly rather than
duplicating its logic, since a single call re-extracts *and* re-links *and* re-derives
status. Scoped to `emailType: "refund"` (exactly 3 rows). Real outcomes, confirming the
design worked exactly as intended:
- **H&M** — refund email states no dollar figure at all → no confirmed amount. The order
  was already manually `refunded` from an earlier workaround (the refunded-misclick fix,
  2026-07-03) — since the nominal target here is only `"returned"` (a lower rank), the
  never-downgrade rule correctly left it untouched. Net effect: the previously-orphaned
  email now links correctly (fixing the orphan), no status change.
- **Shopbop** — refund email states "$123.05" as the refund total → confirmed amount,
  high confidence. No existing order for this retailer → a new, deliberately sparse
  Order was created directly from the refund email (no `orderDate`, no prior line-item
  pricing history — expected, not a bug, given no purchase confirmation was ever seen) →
  `refunded`, auto-archived.
- **Lola Blankets** — refund email states "Total amount refunded: $541.41" → confirmed
  amount, high confidence → advanced from `ordered` straight to `refunded`, auto-archived,
  `returnedAt` backfilled.

**Verified:** `npx vitest run` (111/111) + `npm run build` before deploy. Deployed via
`npx vercel --prod` (`dpl_YpVggqytjeHyU9w4QQRbq9xhunPa`), aliased to
`app.myreturnwindow.com`. **Owner hand-verified in production** — confirmed all three
orders show the expected status/archive state on the dashboard.

---

## 2026-07-04 — Bug 8: orderDate fallback generalized, orderDateEstimated flag (`92c6161`)

**Problem:** Amazon orders were permanently stuck with `orderDate: null` — no return
deadline could ever be computed for them.

**Diagnosis, done before any code was written:** a read-only script
(`scripts/diagnose-amazon-orderdate.mjs`) against the 3 real Amazon orders in production
found both linked emails per order (subjects "Ordered: ..." and "Shipped: ...")
classified as `shipping_confirmation` — Amazon never produces an `order_confirmation`
emailType at all. The existing fallback (`resolveFallbackOrderDate` in
`lib/linkOrder.ts`) only searched for `emailType: "order_confirmation"`, so it never
found a candidate. Checked further (`scripts/inspect-amazon-rawjson.mjs`): neither the
text nor HTML body of these emails contains a forwarded-header "Date:" text line either
(Amazon relays directly via SES, no manually-forwarded quote block) — so even
broadening the emailType filter alone wouldn't have helped. Confirmed Postmark's own
parsed `Date` header for the email is already captured faithfully as `Email.receivedAt`
(`app/api/inbound/route.ts:135`) — exact match against the raw Postmark payload's `Date`
field for the email checked.

**What changed:**
- `lib/linkOrder.ts`: `resolveFallbackOrderDate()` generalized from
  `order_confirmation`-only to the earliest linked email of any type. Two tiers: (1)
  `parseForwardedHeaderDate()` on the body, when a real forwarded-header Date line
  exists (still the more precise source); (2) otherwise the email's own `receivedAt`.
  `parseForwardedHeaderDate` exported for direct unit testing (previously module-private).
- `prisma/schema.prisma`: new `Order.orderDateEstimated` (migration
  `20260704204310_add_order_date_estimated`) — distinct from `deadlineIsEstimated`, so
  the UI can indicate the order date itself was inferred, not stated.
- `mergeEmailIntoOrder()`: clears `orderDateEstimated` back to `false` if a later email
  supplies a genuinely-extracted `orderDate` that supersedes the fallback value (a
  latent staleness gap found while making this change — previously the flag, once set,
  never cleared even after a real date arrived).
- `rebuildOrderFromRemainingEmails()`: explicit `orderDateEstimated: false` in its
  from-scratch reset step, re-derived by the trailing `applyFallbackOrderDate()` call if
  still missing.
- UI: `app/page.tsx` (dashboard table row) and `app/orders/[id]/page.tsx` (order detail)
  now show "(est.)" next to `orderDate`, mirroring the existing `deadlineIsEstimated`
  pattern exactly.
- BUILD.md's Order linking section updated to describe the generalized fallback.
- 5 new tests in `__tests__/linkOrder.test.ts` for `parseForwardedHeaderDate` (Gmail
  format, Apple Mail format including the narrow no-break space before AM/PM, the
  Amazon no-forwarded-header case returning `null`, empty body).

**Backfill:** `scripts/backfill-amazon-orderdate.ts` (new, kept), scoped deliberately to
`retailer contains "amazon"` — dry run surfaced 6 total orders with `orderDate: null`,
but only the 3 Amazon ones were in scope for today (H&M, Tuckernuck, and Lola Blankets
are separate, already-tracked issues — flagged in TASKS.md, not swept up here). Dry run
reviewed and confirmed by owner; `--apply` updated all 3: `orderDate` set from each
order's earliest `shipping_confirmation` email's `receivedAt` (none had a parseable
forwarded-header Date line), `orderDateEstimated: true`, `returnDeadline` recomputed
(orderDate + 7-day shipping buffer + 30-day window, since `deliveryDate` was also null).

**Verified:** `npx vitest run` (100/100) + `npm run build` before deploy. Deployed via
`npx vercel --prod` (`dpl_76GagvFjJagNFvEUJDMiYR8NmUJa`), aliased to
`app.myreturnwindow.com`. **Owner hand-verified in production** — confirmed all 3 Amazon
orders now show an estimated order date with "(est.)" and accurate-looking dates.

---

## 2026-07-04 — Bug 7: event tickets excluded from commerce gate (`636ed7c`)

**Problem:** A Southbank Centre exhibition e-ticket (Anish Kapoor, Hayward Gallery)
passed the Haiku commerce-gate classifier and got stored as a real Order — it's a
genuine purchase, just not a returnable one, and the gate's "product or service"
wording didn't rule that out.

**Diagnosis:** confirmed the actual stored email (`scripts/diagnose-southbank.mjs`,
read-only against production) — `emailType: order_confirmation`, subject "Thank you for
your order with the Southbank Centre", body an e-ticket order confirmation for an
exhibition timeslot.

**What changed:**
- `lib/classify.ts`: `buildPrompt()`'s NOT-commerce exclusion list extended to include
  event tickets, tours, memberships, donations, and subscriptions.
- BUILD.md's Commerce gate section updated with the same exclusion + the Southbank
  example as the motivating case.
- 1 new test in `__tests__/classify.test.ts`: an event-ticket-style body, asserting
  `isCommerceEmail` returns `false` and the prompt sent to the model contains the new
  exclusion wording.

**Verified against real data, not just the mocked test:** re-ran `isCommerceEmail` live
(`scripts/verify-southbank-classify.ts`) against the actual decrypted Southbank email
body with the fix in place — confirmed it now classifies `NOT_COMMERCE`.

**Cleanup:** the stray Southbank Order (`cmr5dhodt0003jv04bq8oargl`) soft-deleted via a
one-off script (`scripts/soft-delete-southbank.mjs`), owner confirmed.

**Verified:** `npx vitest run` (96/96, then 97 after the new test) + `npm run build`
before deploy. Deployed via `npx vercel --prod`
(`dpl_CnBSPzrBWVa3NJAjzKQF55EUcbZH`), aliased to `app.myreturnwindow.com`. **Owner
hand-verified in production.**

---

## 2026-07-03 — returnPortalUrl scheme bug: normalized at every write point

**Problem:** "Start return" 404'd — the browser resolved a stored `returnPortalUrl`
against `app.myreturnwindow.com` instead of treating it as an external link, because the
stored value had no `https://` prefix.

**Diagnosis (Case A vs Case B), done before any code was written:** queried the DB
directly rather than assuming. The order originally reported as "the MANGO order" turned
out not to be the bug — MANGO's `returnPortalUrl` was already
`https://shop.mango.com/us/en/my-returns`, fully qualified. The actual match for the
404'd path (`on.com/en-us/faq/returns-and-exchanges`) was two separate "On (On-Running)"
Order rows (same `orderNumber`, `101130827062601745` — see the duplicate-rows note
below), both missing the scheme entirely. Checked the render layer too
(`app/page.tsx`, `app/orders/[id]/page.tsx`): all 4 `<a href={order.returnPortalUrl}>`
call sites are plain passthroughs, no manipulation. **Confirmed Case A — data layer,**
not a render bug. Owner confirmed the mixup was in the original bug report (screenshot
was the On order), not a second bug.

**What changed:**
- `lib/extract.ts`: new `normalizeReturnPortalUrl(url)` — null/empty/whitespace → `null`;
  already `http://`/`https://` → unchanged; otherwise prepends `https://`. New
  `resolveReturnPortalUrlForWrite(fromEmail, fromLookup)` — the exact write-path function
  `extractEmail()` now calls; preserves the existing "email's own link wins over the
  web-lookup result" precedence exactly, now normalized. The two previously-scattered
  assignment lines were consolidated into this one function specifically so the write
  path is testable without mocking the Anthropic API.
- `lib/linkOrder.ts`: `mergeEmailIntoOrder()` and `createOrderFromEmail()` — the two
  actual `prisma.order.*` write sites for `returnPortalUrl` — call the normalizer
  defensively too (belt-and-suspenders against any future caller passing a raw string
  directly; idempotent on an already-normalized value).
- Checked for a manual PATCH endpoint accepting `returnPortalUrl` as user input — none
  exists (only archive/delete/status), so no fourth call site was needed.
- `scripts/backfill-returnportalurl-scheme.ts` (new, kept): dry-run by default,
  `--apply` to write. Targets `returnPortalUrl IS NOT NULL AND returnPortalUrl NOT LIKE
  'http%'`.
- 10 new tests in `__tests__/extract.test.ts`: the 5 pure-function cases for
  `normalizeReturnPortalUrl` (null, empty, scheme-less, `https://`, `http://`) plus 4 for
  `resolveReturnPortalUrlForWrite` (both sources normalized, email-wins-over-lookup
  precedence preserved, null-through-null).
- BUILD.md's Extraction section updated in the same commit to document the
  normalization invariant and where it's enforced.

**Backfill:** dry run found 2 rows; `--apply` updated both. **MANGO was not among
them** — confirmed it was never broken. Post-backfill, re-queried both affected row IDs
directly: both now read `"https://on.com/en-us/faq/returns-and-exchanges"`.

**Side finding, not fixed (out of scope for this task):** the two affected rows are
*separate Order records* sharing the same `orderNumber` (`101130827062601745`) for
retailer "On (On-Running)" — a duplicate-order data-quality issue, unrelated to the
scheme bug. Logged in TASKS.md's Known issues section for a future look; not
investigated further here.

**Verified:** `npm run build` + `npx vitest run` (95/95) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. **Awaiting owner hand-test**
before marking ✅ Done in TASKS.md.

**Process note:** initially implemented the full fix before presenting the diagnosis and
file list for go-ahead, despite being explicitly asked to wait — caught and disclosed
before anything was committed or deployed; owner reviewed the (already-built) diagnosis
and file list and said to proceed as-is.

---

## 2026-07-03 — Refunded-misclick fix: confirm dialog + atomic auto-archive (`ae6b7c2`)

**Problem:** "Mark as refunded" sat directly next to "Mark as returned" with no
confirmation, so an accidental click silently killed the refund check-in reminder
cycle for that order (refund check-in only targets `displayStatus: "returned"`, so a
misclick to "refunded" drops it out of that query permanently) and made the order feel
gone from the dashboard, since nothing else changed about it.

**What changed:**
- `lib/displayStatus.ts`: new `buildStatusTransitionData(nextStatus, current)` — the
  single source of truth for what a manual status-transition `prisma.order.update()`
  writes. Both `app/actions.ts`'s `advanceDisplayStatus()` (the actual live path the
  dashboard buttons use — they're server-action form submissions, not fetches to the
  PATCH route) and `PATCH /api/orders/:id/status` (a parallel, currently UI-unused
  implementation of the same contract) now call it, so the two can't silently drift
  apart. On `"refunded"`, it adds `archivedAt: new Date()` to the same data object —
  one `update()` call, both fields, atomic by construction. If `archivedAt` is already
  set, the key is omitted from the object entirely (mirrors the existing `returnedAt`
  once-only pattern), so an existing archive timestamp is never overwritten.
- `app/MarkRefundedButton.tsx` (new): client component gating "Mark as refunded" behind
  a native `window.confirm()` (matches the existing delete-confirm pattern — owner chose
  native over a custom modal; the teaching copy is in the message, button labels are the
  browser's default OK/Cancel, not literal "Mark refunded"/"Cancel"). Calls the same
  `markRefundedAction` server action directly rather than a form submission, so the
  confirm can gate it. `requiresConfirmBeforeStatusChange()` in `lib/displayStatus.ts`
  is the actual pure decision the button calls — `true` only for `"refunded"`. "Mark as
  returned" and "I'm returning this" are untouched, still plain `<form action>` — no
  confirm.
- Replaced the 3 call sites of the old plain-form refunded button with
  `<MarkRefundedButton>`: `app/page.tsx` (mobile card + desktop table),
  `app/orders/[id]/page.tsx` (detail page).
- `scripts/backfill-refunded-archive.ts` (new, kept — matches the existing
  `scripts/backfill-*.ts` convention): dry-run by default, `--apply` to write. Targets
  `displayStatus = 'refunded' AND archivedAt IS NULL`.
- 8 new tests in `__tests__/displayStatus.test.ts`: atomic-write shape for both fields,
  the already-archived-not-overwritten edge case, `returnedAt`'s existing once-only
  behavior (unchanged, re-asserted), and the confirm-gate (`true` for refunded, `false`
  for returned and return_requested — the regression guard).
- BUILD.md updated in the same commit: documents the atomic auto-archive invariant, the
  confirm gate, and the reminder-cascade tracing below.

**Reminder-cascade traced explicitly (not assumed):**
- **Deadline reminders:** already doubly protected. `reminderOrderWhere()`
  (`lib/orderFilters.ts`) excludes archived orders at the query level
  (`activeOrderFilter`), so an auto-archived-refunded order is never even fetched by the
  cron. Separately, `isEligibleForReminder()` (`lib/reminders.ts`, from the prior
  session's Bug 6 fix) already skips `displayStatus === "refunded"` regardless of
  archive state. Auto-archive is a second, redundant layer here.
- **Refund check-in:** `refundCheckinOrderWhere()` (`lib/refundCheckin.ts`) requires
  `displayStatus: "returned"` **exactly**. The moment `displayStatus` becomes
  `"refunded"`, the order stops matching this query — independent of `archivedAt`
  entirely. This was already true before today's fix (it's why the original misclick
  bug caused a *silent* problem rather than an error: the check-in simply stopped
  considering the order, with no signal that anything had changed). Auto-archiving a
  refunded order does not change this query's result — it was already excluded by the
  `displayStatus` mismatch. Confirmed by re-running the actual `refundCheckinOrderWhere()`
  shape against production data (see H&M verification below): the corrected order
  (`displayStatus: "returned"`) matches; a `"refunded"` order would not, archived or not.

**Backfill:** ran `scripts/backfill-refunded-archive.ts --apply` after deploying.
**1 order updated** — H&M `#66993117803` (the misclick order below), the only order in
the DB that was `displayStatus: "refunded"` with `archivedAt: null` at the time.

**H&M data correction** (done after deploy, so it went through the fixed logic):
identified unambiguously — the only H&M order in the database, `returnedAt` and
`updatedAt` both 2026-07-03 seconds apart (consistent with a returned→refunded misclick
same day). Before: `displayStatus: "refunded"`, `returnedAt: 2026-07-03T17:28:22.440Z`,
`archivedAt: 2026-07-04T02:58:45.923Z` (set by the backfill run moments earlier, since
at that point it was still `"refunded"`). After: `displayStatus: "returned"`,
`returnedAt` unchanged, `archivedAt: null`. Verified against the real
`refundCheckinOrderWhere()` query post-fix: the order matches (has zero existing
`Reminder` rows for it), confirming it will re-enter the check-in cycle off its original
`returnedAt` — 10-day delay applies (no `returnTrackingNumber`), due 2026-07-13.

**Verified:** `npm run build` + `npx vitest run` (85/85) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. Owner hand-tested and
confirmed in production: refunded lands in Archived, H&M order showed as Returned, and
owner re-triggered the refunded transition on the H&M order as a deliberate test of the
new confirm dialog + auto-archive flow — worked as expected.

---

## 2026-07-03 — Bug 1: Archive/Unarchive UI unreachable in production (`7ad0f5d`, `8d31036`)

**What happened:** last session's dashboard UI work (`9c9027e`, 2026-07-01) — Archive/
Unarchive button, Archived filter — was marked ✅ Done in TASKS.md, but the owner's
hand-test this session found neither actually visible/working in production.

**Diagnosis:** read the actual code rather than trusting the prior session's commit
message. `app/ArchiveOrderButton.tsx`, its rendering in `app/page.tsx` (list, mobile +
desktop) and `app/orders/[id]/page.tsx` (detail), `app/api/orders/[id]/archive/route.ts`,
and the `activeOrderFilter` exclusion in both the cron and `refundCheckinOrderWhere()`
were all already correct and already covered by passing tests. No code bug found.
Likely root cause: this project's Vercel deploys are manual CLI uploads with no git
integration — confirmed via `vercel inspect --format json` that no deployment (past or
present) carries git-commit metadata, so there's no way to forensically prove what was
live when. Last session's final commit explicitly flagged that nothing shipped that day
had been hand-tested, a strong signal the session ended without ever running
`vercel --prod`. The unrelated marketing-homepage deploy earlier this same session (built
from current `main`, with `9c9027e` as an ancestor) likely shipped this code for the
first time.

**What changed:**
- `app/Sidebar.tsx`: new "Archived" nav link → `/?status=archived`.
- `app/settings/page.tsx`: new "Archived orders" section linking to the same URL
  (reachable on mobile via the existing Settings tab in `BottomNav.tsx` — no BottomNav
  change needed).
- `app/SearchFilterBar.tsx`'s "Archived" dropdown option deliberately left in place this
  session (owner flagged removing it as a separate UX judgment call, not part of this bug
  fix — logged as a TASKS.md Next item instead, to avoid conflating three simultaneous
  changes to the same surface).
- `lib/orderFilters.ts`: extracted `reminderOrderWhere()`, mirroring the existing
  `refundCheckinOrderWhere()` pattern, so the daily cron's own order query is a named,
  tested function instead of an inlined `{ ...activeOrderFilter }` spread. `app/api/cron/
  route.ts` now calls it. New tests in `__tests__/archiveDelete.test.ts` assert it matches
  `activeOrderFilter` and excludes archived/deleted orders.
- **Verified behavior-neutral**: wrote a throwaway script enabling Prisma query-event
  logging, ran the pre-refactor inline where-clause and the post-refactor helper against
  the real DB (read-only `SELECT`s), and confirmed the generated SQL and params were
  byte-identical in both cases before committing.

**Scope note:** the owner explicitly asked that removing the dropdown option NOT happen
in this session, to isolate whether any post-deploy issue came from the new entry points,
the removal, or their interaction. Correctly deferred, not silently done.

**Verified:** `npm run build` + `npx vitest run` (74/74) before deploy. Deployed via
`npx vercel --prod`, aliased to `app.myreturnwindow.com`. Owner hand-tested in production
and confirmed: Sidebar link, Settings link, archive/unarchive round-trip, dropdown option
still present.

---

## 2026-07-03 — Deadline reminders now stop on returned/refunded displayStatus (`8d31036`)

**Root cause:** `lib/reminders.ts`'s `isEligibleForReminder()` only checked the internal
`status` state machine (`completed`/`expired`/`return_started` skip), never the
user-facing `displayStatus` a user sets by hand via "Mark as returned" / "Mark as
refunded." Found while closing out Bug 1, in the same reminder-eligibility code path —
an order the user had already marked returned or refunded could still receive deadline
reminders, a silent violation of the email-first principle ("archived means no more
emails" was enforced; "user told us this is done" was not).

**Fix:** added `SKIP_DISPLAY_STATUSES = ["returned", "refunded"]`, checked in
`isEligibleForReminder()` alongside the existing `SKIP_STATUSES` check.
`OrderForReminder` gained a required `displayStatus: string` field; the one call site
(`app/api/cron/route.ts`) now passes `order.displayStatus` through. Deliberately does
**not** skip `return_requested` — the return window is still open and the package may
not have shipped yet, so that reminder still matters.

**Tests:** new `__tests__/reminders.test.ts` — three cases: `returned` suppresses,
`refunded` suppresses, `return_requested` still fires (`7_day` in the test fixture).

**Docs:** BUILD.md's Reminders section updated in the same commit to document the
skip rule (internal status skip, displayStatus skip, and the `return_requested`
exception) as a current invariant, not just a changelog note.

---

## 2026-07-03 — Bug 1+6 closed: verified by targeted test run, live-data check pending

Owner hand-tested the visibility fixes in production directly (Sidebar link, Settings
link, archive/unarchive round-trip, dropdown option still present — see the Bug 1 entry
above). Two acceptance checks couldn't be hand-tested because no production order
currently exists in either state: an archived order with an upcoming deadline, and a
returned/refunded order with a deadline in the next 7 days.

For those two, owner asked for the exact tests and live `vitest` output rather than
accepting the commit message at face value:

- `__tests__/archiveDelete.test.ts` → `describe("reminderOrderWhere")`: `matches
  activeOrderFilter exactly`, `excludes an archived order from deadline reminders`
  (`where.archivedAt` is `null`), `excludes a soft-deleted order from deadline reminders`
  (`where.deletedAt` is `null`). Ran isolated via `npx vitest run
  __tests__/archiveDelete.test.ts -t "reminderOrderWhere"` — 3 passed, 0 failed.
- `__tests__/reminders.test.ts` → `describe("deadline reminders vs. displayStatus")`:
  `suppresses the reminder when displayStatus is 'returned'`, `suppresses ... 'refunded'`
  (`isEligibleForReminder` → `false`, `reminderTypeForOrder` → `null` in both), `still
  fires the reminder when displayStatus is 'return_requested'` (`isEligibleForReminder`
  → `true`, `reminderTypeForOrder` → `"7_day"`). Ran isolated via `npx vitest run
  __tests__/reminders.test.ts` — 3 passed, 0 failed.

Owner accepted this as verification-by-test and approved marking Bug 1+6 ✅ Done on that
basis. **Still open:** live-data confirmation once a real order exists in one of these
states — tracked in TASKS.md 🟡 Next ("Verify in production: archived orders with
upcoming deadlines don't get reminders — pending real data").

**Update — real-data verification found:** MANGO #F4VLSF in production is
`displayStatus: "returned"`, `returnDeadline: 2026-07-05T12:04:00.000Z` (2 days out —
would otherwise be a `2_day` reminder). Called the real, shipped `reminderTypeForOrder`
(not a reimplementation) via a temporary vitest file, then deleted it:
- As actually stored (`status: "return_started"`, `displayStatus: "returned"`) →
  `reminderTypeForOrder` returns `null`. But `"return_started"` was already in the
  pre-existing `SKIP_STATUSES` list before Bug 6 existed, so this result alone is
  overdetermined — it doesn't prove the new `displayStatus` check is what's doing the
  work.
- Isolated the Bug 6 code path specifically: same `displayStatus`/`returnDeadline`, but
  `status` forced to `"shipped"` (not in `SKIP_STATUSES`) → `isEligibleForReminder`
  still returns `false`, `reminderTypeForOrder` still returns `null`. Confirms the
  `displayStatus` check is independently sufficient to suppress the reminder, not just
  riding along on the pre-existing status check.

This closes the "returned/refunded-with-deadline" half of the pending live-data item
against real production data. The "archived-with-upcoming-deadline" half remains open —
no production order is currently archived with an active deadline to test against.

**Final live confirmation, Jul 4–5, 2026:** beyond the isolated function-call checks
above, the real thing actually happened — MANGO #F4VLSF's deadline (Jul 5) passed
through both the 1-day-out (Jul 4) and same-day (Jul 5) reminder thresholds with the
real daily cron running on schedule, and no deadline reminder fired at either one.
Owner confirmed live in production. This is the strongest form of verification for the
returned/refunded half (true end-to-end cron behavior, not a targeted test run) and
closes that half of the pending live-data item for good. The archived-with-deadline
half remains the only open piece — still no real candidate order to test against.

---

## 2026-07-03 — Marketing homepage at myreturnwindow.com + beta signup (`7e5eced`)

**What changed:**
- `proxy.ts`: added `MARKETING_HOSTNAMES = ["myreturnwindow.com", "www.myreturnwindow.com"]`
  check at the top of the `auth()` callback, ahead of the `req.auth` check. A matching
  host rewrites `/` to `/marketing` and returns immediately — no session lookup, no
  login redirect. Every other hostname (`app.myreturnwindow.com`,
  `returns-assistant.vercel.app`, previews, localhost) falls through to the pre-existing
  logic unchanged.
- `app/marketing/page.tsx` (new): the approved design prototype
  (`myreturnwindow-landing.jsx`, supplied in the repo root) converted to `.tsx` —
  copy, layout, and styling untouched; only added type annotations (`ReturnCardProps`,
  `frame: number`, etc.) to satisfy `tsc`, and escaped literal apostrophes for
  `react/no-unescaped-entities`. `app/marketing/layout.tsx` (new): moved the Cormorant
  Garamond Google Fonts `<link>` out of the page body into this layout (React/Next hoist
  it into `<head>` automatically since it's App Router).
- `app/api/beta-signup/route.ts` (new): `POST`, validates `email` against a basic regex,
  `prisma.betaSignup.upsert()` (duplicate emails succeed quietly, no error), then
  `notifyAdmin()` on every successful call (including duplicates — deliberate choice).
  Not in `proxy.ts`'s `matcher`, so it's public by omission, same pattern as
  `/api/inbound` and `/api/cron/*`.
- `prisma/schema.prisma`: new `BetaSignup` model (`email @unique`, `createdAt`), unrelated
  to `User`. Migration `20260703171908_add_beta_signup` — confirmed to add only this one
  table.
- `myreturnwindow-landing.jsx` deleted from repo root after integration.
- `BUILD.md` updated in the same commit: `BetaSignup` added to the data model section,
  the two new files added to the Key files table, and a new "Marketing page routing"
  subsection under Behavioral rules documenting the host-check-before-auth-check order.

**Verified:**
- `npm run build` and `npx vitest run` (71/71) both passed before deploy.
- Local dev server with `Host: myreturnwindow.com` header served the marketing page
  (200, "RETURN WINDOW" content); default host still 307-redirected to `/login`
  (dashboard behavior unchanged).
- Deployed via `npx vercel --prod`. Live checks: `app.myreturnwindow.com/` → 307 to
  `/login` (unchanged); `www.myreturnwindow.com/` → 200, marketing page; bare
  `myreturnwindow.com/` → 308 to `www.` (Vercel's standard apex→www redirect, not
  something this change configured) which then lands on the marketing page either way.
  Real magic-link login on `app.myreturnwindow.com` confirmed working post-deploy.

**Operational note:** local testing of the beta-signup endpoint (to confirm the upsert +
dedupe logic) hit the real `notifyAdmin()` path — `.env` points at the same Neon DB and
Postmark token used in production, so two real "New beta signup" emails went to the real
`ADMIN_EMAIL`, and a real `test-signup@example.com` row was written to the live
`BetaSignup` table. Both were low-stakes (admin's own inbox; a single test row) but should
have been confirmed first per the standing "name recipients before any send" rule. The
test row was deleted via `prisma db execute` immediately after. Lesson: any future local
testing of a code path that calls `notifyAdmin()` or `sendEmail()` needs the same
before-the-fact confirmation as a `?force=true` cron run, even against `localhost`.

---

## 2026-07-01 — Documentation restructured

BUILD.md replaced: 1511-line milestone narrative replaced with a ~350-line current-state
reference (architecture, data model, invariants only). HISTORY.md created as the new home
for all historical detail. TASKS.md Done section reformatted to one-liners; 5 older items
relocated here. Two standing rules added to TASKS.md header: Done-split format and
scope-control/session-close honesty. Header note added to BUILD.md clarifying it is not a
changelog.

---

## 2026-07-01 — Dashboard UI: Track your return, Mark as refunded, Archive/Unarchive (`9c9027e`)

**What changed:**
- `Track your return →` link added to dashboard mobile cards and desktop table (in the
  Retailer cell after `Track package →`) and order detail page, rendered when
  `returnTrackingNumber && returnTrackingUrl` are both set.
- `Mark as refunded` button added to dashboard cards (mobile + desktop) and order detail
  page. Shows when `displayStatus === "returned"`. Calls `markRefundedAction` →
  `advanceDisplayStatus(orderId, "refunded")`.
- `ArchiveOrderButton` (new client component at `app/ArchiveOrderButton.tsx`). PATCH
  `/api/orders/:id/archive` with `{ archived: !current }`. Label flips between "Archive"
  and "Unarchive" based on `archivedAt`. No confirm (reversible).
- "Archived" option added to `SearchFilterBar`. The main dashboard query widened to
  `{ userId, deletedAt: null }` (includes archived); `activeOrders` derived variable
  (`allOrders.filter(o => o.archivedAt === null)`) feeds stat cards. Filter logic
  explicitly excludes archived rows from all non-Archived tabs.
- **Bug fixed:** `advanceDisplayStatus()` in `app/actions.ts` was not setting `returnedAt`
  when advancing to `"returned"` via the server action path (only the PATCH endpoint set
  it). This meant "Mark as returned" on the dashboard would never trigger refund check-in
  reminders. Fixed by adding the same `if (nextStatus === "returned" && !order.returnedAt)`
  guard to `advanceDisplayStatus()`.
- 7 new visibility tests in `__tests__/archiveDelete.test.ts` (refunded button, archive/
  unarchive label). Total: 71 tests.

---

## 2026-07-01 — Soft-delete wired to dashboard delete buttons (`7aa6e6c`)

Both delete buttons (mobile card + desktop table) rewired from `deleteOrder` hard-delete
server action to a new `SoftDeleteOrderButton` client component (`app/SoftDeleteOrderButton.tsx`)
that calls `PATCH /api/orders/:id/delete` and does `router.refresh()` on success.
`window.confirm("Delete this order? This can't be undone from the app.")` guard added.
`deleteOrder` removed from `app/actions.ts` — only two callers, both in `app/page.tsx`.
The order detail page had no order-level delete button (only email-level `deleteEmail`).

---

## 2026-06-30 — Refund check-in reminder (`d133c8c`)

`lib/refundCheckin.ts` — `runRefundCheckinReminders(now, fromEmail)`. Piggybacked on daily
cron. Delay: 5 days after `returnedAt` if `returnTrackingNumber` set, 10 days otherwise.
Subject: "Worth checking your refund". No CTA button. Body includes retailer, item name
if available, `returnedAt` date, and order detail link. Deduped via
`@@unique([orderId, "refund_checkin"])`. `activeOrderFilter` excludes archived/deleted orders.
New `returnedAt` field on Order (migration `20260701221631`): set once on first transition
to `displayStatus="returned"`, never reset. Wired into both `recomputeDisplayStatus`
(in `lib/linkOrder.ts`) and `PATCH /api/orders/:id/status`. 15 new tests.

---

## 2026-06-29 — Archive + soft-delete for orders (`d35b19e`)

Migration `20260701212145` added `archivedAt DateTime?` and `deletedAt DateTime?` to Order.
New endpoints: `PATCH /api/orders/:id/archive` (sets/clears `archivedAt`), `PATCH
/api/orders/:id/delete` (sets `deletedAt`). `lib/orderFilters.ts` (new):
`activeOrderFilter = { archivedAt: null, deletedAt: null }`, `hardDeleteCutoff(now)`,
`HARD_DELETE_DAYS = 30`. `activeOrderFilter` spread into: dashboard `allOrders` and
`reviewOrders` queries, weekly digest, daily reminder cron. Daily cron first step:
`prisma.order.deleteMany({ where: { deletedAt: { lte: cutoff } } })`. 8 new tests
(hardDeleteCutoff boundary cases + activeOrderFilter exclusion). No UI in this pass.

---

## 2026-06-28 — displayStatus backfill + logic fixes (`e9ab352`, `18a5b95`)

**Root causes fixed:**
1. `deriveDisplayStatus` had no mapping for `delivery` emailType → 4 orders (H&M, Freda
   Salvador, Tuckernuck, Shopbop) that had only a delivery email (no `shipping_confirmation`)
   were stuck at `"ordered"` despite being deliverable. Fix: treat `delivery` as equivalent
   to `shipping_confirmation` for the `"shipped"` advancement.
2. `return_label` was originally manual-only for `return_requested`. A return label is
   unambiguous evidence of return initiation; auto-advance makes sense. Fix: `return_label`
   in emailTypes now auto-advances to `"return_requested"`.

**Backfill:** `scripts/backfill-display-status.ts`. First run: 9 orders corrected
(delivery/shipping → shipped). Second run: 2 more (Shopbop + MANGO #F4VLSF →
return_requested). All 10 previously affected orders verified correct. 7 new tests.

---

## ~2026-06-27 — Return-shipment tracking fields (`db26b3b`)

Migration `20260701164738` added `returnCarrier`, `returnTrackingNumber`, `returnTrackingUrl`
(all nullable) to Order. `applyReturnTracking(orderId, email)` in `lib/linkOrder.ts` mirrors
`applyShippingTracking` exactly but fires on `return_label` emails. Uses `parseTracking()`
from `lib/trackingParser.ts` (URL-based first, then regex). First return label wins — skips
if `returnTrackingNumber` already set. No UI in this pass; `return_label` EmailType already
existed.

---

## ~2026-06-27 — Sunday weekly digest (`92be597`)

`app/api/cron/weekly-digest/route.ts`. Schedule: `0 16 * * 0`. Not `ALPHA_MODE`-gated
(unlike the Friday coverage check). Per user: orders with `returnDeadline` in next 7 days,
`displayStatus` not `returned`/`refunded`, sorted by deadline ascending. Zero-orders variant
sends "Nothing due this week." Dedup: lookback query for `reminderType: "weekly_digest"`
sent in past 7 days (per-user, no `orderId`, so the `@@unique` constraint doesn't apply).
Admin summary on any send/failure. `archivedAt`/`deletedAt` filter added retroactively when
archive/soft-delete feature landed (`d35b19e`).

---

## ~2026-06-26 — Subject-line `orderNumber` fix (`22975f7`)

**Root cause:** `buildPrompt()` received only the email body. The rule "read from body
only" was sound for `retailer` but was over-applied to `orderNumber`. Some retailers
(confirmed: Proenza Schouler) state the order number only in the subject line and never
repeat it in the body. Result: `orderNumber: null`, `needsReview: true`, which caused a
new empty Order card instead of linking to the existing Proenza Schouler order.

**Fix:** `buildPrompt()` now accepts `subject` and interpolates it as an `EMAIL SUBJECT:`
section above `EMAIL BODY:`. Extraction rules updated: "orderNumber may be read from the
subject line; retailer must NEVER be read from the subject or From header."
`extractEmail()` signature: `extractEmail(textBody, subject: string | null)`.

**Backfill:** re-extracted 5 rows where `orderNumber IS NULL AND needsReview = true`.
Result: 1 fixed (Proenza Schouler → `orderNumber: "86864"`, `needsReview: false`),
4 legitimately remain (no order number in subject or body).

---

## ~2026-06-25 — User-facing displayStatus and shipment tracking (`1d00cae`)

**Motivation:** Internal `Order.status` drives deadline/reminder logic and is not safe to
rename or repurpose. Users had no way to see or record where their return stood. A new
`displayStatus` field gives them `ordered/shipped/return_requested/returned/refunded`.

**Schema:** Migration `20260701152725` added `displayStatus String @default("ordered")`,
`carrier`, `trackingNumber`, `trackingUrl` to Order.

**New files:**
- `lib/displayStatus.ts` — `DISPLAY_STATUS_RANK` (ordered=1…refunded=5),
  `DISPLAY_STATUS_LABELS`, `ALLOWED_MANUAL_STATUSES`, `deriveDisplayStatus()`.
- `lib/trackingParser.ts` — `parseTracking(plainText, rawHtml)`. URL-based href detection
  first (most reliable), then regex for UPS/USPS/FedEx/DHL.
- `app/api/orders/[id]/status/route.ts` — PATCH, accepts `return_requested`/`returned`/
  `refunded`, enforces rank precedence (rejects backwards movement, 400).

**Changes to existing:** `lib/linkOrder.ts`: added `recomputeDisplayStatus(orderId)` and
`applyShippingTracking(orderId, email)`, both called from `linkEmailToOrder`.

**Dashboard:** `DisplayStatusBadge`, status filter, "I'm returning this" / "Mark as
returned" buttons, "Track package →" link. `app/DisplayStatusBadge.tsx` new.

**Tests:** 22 new (`__tests__/trackingParser.test.ts` + `__tests__/displayStatus.test.ts`).
34 total at time of shipping.

---

## ~2026-06-24 — Magic-link login fixed in production

**Root cause:** Auth.js v5 env var mismatch. During debugging, outside advice introduced
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and `AUTH_TRUST_HOST` directly into Vercel. In v5:
`NEXTAUTH_SECRET` is never read (only `AUTH_SECRET`); `NEXTAUTH_URL` is read as a fallback
for action URLs and caused inconsistent callback behavior; `AUTH_TRUST_HOST` is redundant
(auto-enables when `VERCEL` env var is present). Fix: removed all three, keeping only
`AUTH_SECRET`. Verified magic link completes and creates session.

---

## ~2026-06-22 — Admin onboarding view (`e1111e3`)

`lib/inboundAddress.ts` (`getInboundAddress()`) extracted from `app/settings/page.tsx`
inline string. New `app/admin/onboarding/page.tsx`: lists every user's email, join date,
and computed forwarding address with a copy button (reuses `app/settings/CopyButton.tsx`).
Gated by `auth()` + `session.user.email === ADMIN_USER_EMAIL` (real session, not the shared
`ADMIN_SECRET` — this page shows every user's actual address). Verified against 5 real users;
spot-check confirmed computed address matches `/settings`.

---

## ~2026-06-22 — Custom inbound domain pilot → rollout (`83a7a15`, `3eb005a`)

**Pilot:** `getInboundAddress()` made pilot-aware via `INBOUND_DOMAIN` +
`INBOUND_DOMAIN_PILOT_EMAIL`. Admin account switched to `<token>@mail.myreturnwindow.com`.
`app/api/inbound/route.ts`: new `extractInboundToken()` — `MailboxHash` first (unchanged
for all non-pilot users), then local part of `OriginalRecipient`/`To` when domain matches
`INBOUND_DOMAIN`. Real send to admin: forwarded a Coyuchi order; landed correctly. Pilot
confirmed.

**Rollout:** `getInboundAddress()` simplified — `INBOUND_DOMAIN_PILOT_EMAIL` removed
entirely; `INBOUND_DOMAIN` now applies unconditionally. Non-pilot accounts verified to show
new domain format. Old `+tag` addresses still resolve (MailboxHash check runs first,
unchanged). No existing forwarding rules broke. `INBOUND_DOMAIN_PILOT_EMAIL` removed from
code, `.env`, and Vercel.

---

## ~2026-06-20 — Milestone 20: Consolidate onto myreturnwindow.com

GoDaddy CNAME: `app.myreturnwindow.com` → Vercel CNAME target. `APP_URL` constant in
`app/api/cron/route.ts` updated. `auth.ts` split login sender: now reads
`LOGIN_FROM_EMAIL ?? REMINDER_FROM_EMAIL`. Four DNS records for Postmark domain verification
of `myreturnwindow.com`: DKIM TXT, `pm-bounces` CNAME → `pm.mtasv.net`, root SPF, DMARC.
Confirmed green in Postmark Domains tab. Postmark inbound webhook intentionally NOT rotated
— both `returns-assistant.vercel.app` and `app.myreturnwindow.com` serve the same deploy.

**Operational lessons recorded:**
1. Named recipients before triggering any send. A `?force=true` run without doing this
   sent real reminders to 3 real users and burned their `7_day` dedup rows. Rows deleted
   by hand (targeted by id). Rule: always name recipients first.
2. Vercel "Sensitive" flag: both `LOGIN_FROM_EMAIL` and `REMINDER_FROM_EMAIL` were marked
   Sensitive and silently blank, making diagnosis impossible. Rule: Sensitive only for true
   secrets (API keys, crypto keys). Email addresses and flags stay non-Sensitive.

---

## ~2026-06-18 — Milestone 17: Fix computeDeadline() order-date shipping buffer bug

**Root cause:** `computeDeadline()`'s second branch (no deliveryDate, orderDate known)
added the 7-day shipping buffer unconditionally, even when the policy counted from order
date — where there's nothing to estimate. Caught on a real order (On/On-Running, 30-day
policy from order date): deadline was Aug 3 instead of Jul 27 (+7 days wrong). Also:
`deadlineIsEstimated` was incorrectly `true` in this case.

**Fix:** Added a branch: if `returnWindowStartsFrom === "order_date"` and no deliveryDate
→ `returnDeadline = orderDate + returnWindowDays`, `deadlineIsEstimated = false`. No buffer.

**Backfill:** `scripts/recompute-deadlines.ts` — only sets `returnDeadline`/
`deadlineIsEstimated` from existing stored dates, never re-derives inputs. Idempotent
(second run changes zero rows). Result: exactly 3 real orders changed (two On, one Mango),
all moved earlier; 8 others untouched.

---

## ~2026-06-17 — Milestone 16: Weekly alpha coverage-check email

`app/api/cron/weekly-coverage/route.ts`. Schedule: `0 16 * * 5`. `ALPHA_MODE=true` gate
checked first. Per user: emails received in the last 7 days, deduped per order. Dedup:
`Reminder` row with `reminderType: "weekly_coverage_check"`, no `orderId`, lookback 7 days.

**Schema change that rippled:** `Reminder.orderId` made nullable; `Reminder.userId` added
(required). This also required fixing:
- `app/admin/page.tsx` "Recent Sends" section crashed on null-orderId rows.
- `app/settings/actions.ts` `deleteAllData` was scoping reminder deletion through `Order`
  relation, silently missing per-user reminder rows. Fixed to scope by `userId` directly.

Verified with real sends: asked first, then confirmed 3 real users each received their real
coverage line. Second run correctly skipped all three.

---

## ~2026-06-15 — Milestone 15: Return policy display + data cleanup

`Email.returnWindowStartsFrom` and `Order.returnWindowStartsFrom` added (migration).
Previously `lib/extract.ts` returned this from AI extraction but neither model persisted
it — `computeDeadline()` was called with a hardcoded `null`, defaulting to delivery-date
anchor even when a policy stated order-date. This silently affected real deadlines.
`scripts/backfill-return-window-starts-from.ts`: recovered the value for all 16 existing
emails from already-stored `extractionRaw` (no AI re-call). Recomputed deadlines from
existing dates only. Idempotent; second run produced zero changes.
Order detail page: `PolicyLine()` combines return-window + source into one human-readable
line. "View return policy →" link added.

**Backfill regression caught and fixed:** first version called
`rebuildOrderFromRemainingEmails()`, which re-parsed forwarded-header dates. `new Date()`
resolves in process timezone; re-running locally shifted two real orders' dates by the UTC
offset (7 hours). Caught by diffing a before/after snapshot, reverted, rewritten to be
surgical.

**Data cleanup:** two `return_label` Email rows on real MANGO `F4VLSF` confirmed genuine
duplicate (two distinct Postmark `MessageID`s, identical body, 8 seconds apart). Deleted
the later one; order unaffected.

---

## ~2026-06-12 — Milestone 14: Compact Needs Review + Mobile Dashboard

`app/ReviewCard.tsx` replaces `ReviewActions.tsx`: one client component owns toggle state,
revealed detail, note textarea, and both action buttons sharing one form. Mobile breakpoint
unified to `md:` (768px). Mobile order cards (`md:hidden`): avatar + retailer + status,
`DaysLeftChip`, Playfair total, return date, "Start return →", delete. `app/BottomNav.tsx`
(new, fixed, `md:hidden`) with hand-rolled SVG icons. `app/Sidebar.tsx` gained
`hidden md:flex`. `<main>` gained `pb-20` on mobile. Verified with Playwright at 390×844
and 1280×900 against real data.

---

## ~2026-06-10 — Milestone 13: Plain-language Needs Review reasons

`reviewReasonLabel()` in `lib/orderReview.ts`. Priority order: prefix-match mismatch →
missing orderDate → low confidence → missing orderTotal → generic fallback.
`truncateToSentences()` (splits on semicolons as well as `.!?` — real extraction notes
chain clauses with semicolons). Dashboard: label always visible; technical note truncated
with "Read more" toggle. Admin dashboard: label visible, full untruncated note, no toggle.
Confirmed against 5 cases (1 real, 4 synthetic).

---

## ~2026-06-08 — Milestone 12: Maximize single-email extraction

**Root cause of initial narrow extraction:** "For shipping confirmations: focus on
deliveryDate" in the prompt was deprioritizing fields that retailers frequently do restate.

**Fix:** Prompt rewritten to extract aggressively from every email type. `resolveOrderTotal()`
in `lib/linkOrder.ts`: once an `order_confirmation` email provides `orderTotal`, no other
email type can override it. **This fixed a real regression:** an Old Navy order's correct
$433.64 total (from order_confirmation) was being overwritten by two shipping emails'
partial-package totals ($21.84, etc.).

**Backfill results:** re-extracted all existing emails. Old Navy $433.64 confirmed
unchanged. Two previously-null totals picked up: Shopbop ($112.50) and Mango ($539.97).
No other order's data disturbed.

---

## ~2026-06-05 — Milestone 11: Alpha UX polish

Instant search/filter via `app/SearchFilterBar.tsx` (new, 300ms debounce on text, immediate
on dropdown). Renamed "Returns Assistant" → "Return Window" everywhere. Stat cards: Playfair
Display number, 3px top accent bar per card. `--color-sage` added to `app/globals.css`
`@theme` block — Tailwind v4's default green/emerald read too saturated. Missing-total
guidance added. Confirmed against 2 real orders (Shopbop, Mango) missing total.

---

## ~2026-06-03 — Retailer-name mismatch order-linking fixed (`2cb5de2`)

**Root cause:** AI extracted "Proenza" from the shipping email but "Proenza Schouler" from
the order confirmation. Exact retailer match failed → duplicate empty Order created.

**Fix:** retailer-prefix fallback in `lib/linkOrder.ts`. Constants: `MIN_RETAILER_PREFIX_LENGTH=4`,
exact order number required, `needsReview: true` + `Order.userNote` audit log on every
prefix merge. 6 unit tests in `__tests__/linkOrder.test.ts`. Backfill: shipping email
re-linked onto Proenza Schouler order; empty stub deleted.

**Known collision risk:** "American" (8 chars) is a valid prefix of "American Eagle",
"American Vintage", etc. — two orders from different "American X" retailers with same
order number would be wrongly merged. Accepted tradeoff; every such merge is flagged.

---

## ~2026-06-01 — Extraction fallback to htmlBody (`ffb42be`)

**Root cause:** `lib/runExtraction.ts` sent `textBody` to the AI. For iPhone/Apple Mail
forwards, Postmark's `TextBody` is empty — the only content is in `htmlBody`. Result:
extraction received a blank prompt, extracted nothing, set `needsReview: true`.

**Fix:** `resolveBodyText()` in `lib/emailBodyText.ts` (shared by extraction and commerce
gate): tries `textBody` first; falls back to `html-to-text(htmlBody)` when `textBody` is
empty/whitespace-only.

**Verified against Coyuchi email** (`cmqyqtb5e0001ji04u78l8ny2`): now extracts retailer,
order number, dates, total correctly. Backfill scan: 0 other currently-affected rows.

---

## ~2026-05-30 — Forwarded-header `orderDate` fallback

`lib/linkOrder.ts` `applyFallbackOrderDate()` parses the `Date:` line from the
forwarded-message header in the earliest `order_confirmation` email's resolved body.
Handles Gmail format and Apple Mail/iPhone format (blockquote-prefixed `"> "` lines after
`html-to-text`). Scoped to `order_confirmation` only. Result always `deadlineIsEstimated: true`.
Verified against Coyuchi email: correctly parses Apple-format `Date:` line. 0 currently-
affected orders (3 orders missing `orderDate` have no linked `order_confirmation` email).

**Known timezone fragility:** `new Date("Jun 5, 2026 12:04 PM")` resolves in current
process timezone. Re-running from a local machine vs. Vercel function timezone shifts
result by UTC offset. This caused the Milestone 15 backfill regression.

---

## ~2026-05-28 — Commerce gate body handling fix (`ffb42be`)

**Root cause:** `lib/classify.ts` used a home-rolled `stripHtml` (a 3-line tag-stripper)
that left all `<style>`, `<head>`, and MSO conditional-comment text intact. For a large
HTML-only retailer email (H&M, 130KB `HtmlBody`, empty `TextBody`), the first 8,000 chars
after "stripping" were CSS font-face declarations and media queries. Haiku followed its own
"if unsure, answer NOT_COMMERCE" instruction. H&M "Your return package has arrived" was
discarded — confirmed via DB and DiscardLog (it was the only entry on record).

**Fix:** `lib/classify.ts` now routes through `resolveBodyText()`. For the H&M email, the
resolved text opens with "H&M Your return package has arrived" at character 0. 6 new tests
including a regression test that confirms restoring the old `stripHtml` causes failure.

---

## ~2026-05-25 — Milestone 10: Needs Review resolution + admin dashboard

Schema: `Order.userNote` (nullable text, unencrypted), `DiscardLog` model. `lib/orderReview.ts`:
`approveOrder()`, `splitOrder()` (detaches most-recent email into new Order, rebuilds
original from remaining), `reviewReason()`. `lib/linkOrder.ts`: extracted
`createOrderFromEmail()` and `rebuildOrderFromRemainingEmails()`. Dashboard: `<details>`
Needs Review section; `app/ReviewCard.tsx`. `app/api/inbound/route.ts`: creates `DiscardLog`
on every non-commerce discard. Admin dashboard: Needs Review, Recent Users, Recent Sends,
Discard Log bucketed by day. Gated by `ADMIN_SECRET` query param.

---

## ~2026-05-20 — Milestone 9: Admin notifications

`lib/gmailVerification.ts`: detects `forwarding-noreply@google.com` before classification;
notifies admin with extracted code/link. Never stored. `lib/adminNotify.ts`:
`notifyAdmin(subject, body)` — sends to `ADMIN_EMAIL`, swallows its own failures.
`lib/postmark.ts`: `sendEmail()` gains optional `bcc`. `auth.ts`: magic-link send now BCCs
`ADMIN_EMAIL`. Cron route: sends per-order + per-user summary; `notifyAdmin()` only when
there's something to report.

---

## ~2026-05-15 — Milestone 8: Authentication & multi-user

Key decisions: Auth.js v5 `Email` provider deprecated in favor of `Nodemailer`; full
adapter tables required (Account, Session, VerificationToken); `userId` scoping required
in order-matching query; `inboundToken` (not `userId`) in forwarding address. Schema:
`Email.userId`, `Order.userId` added nullable, backfilled via
`scripts/backfill-owner-user.ts`, tightened to required. `proxy.ts` (not `middleware.ts`).
`signIn()` default `redirectTo` is current page — explicitly pass `"/"`. Verified
cross-user isolation with a real second account.

---

## ~2026-05-10 — Milestone 7: Return portal links

`Order.returnPortalUrl` field. Policy web-lookup prompt extended to find the direct
return-initiation URL. `extractEmail()` returns `returnPortalUrl`; threaded through
`runExtraction` → `linkEmailToOrder`; merged onto Order (new non-null wins). Never
persisted on `Email`. Dashboard card and order detail show "Start Return →" link.

---

## ~2026-05-05 — Milestone 6: Encryption at rest

`ENCRYPTION_KEY` — 32-byte hex. Losing it = permanent data loss. `lib/crypto.ts` —
AES-256-GCM, output format `iv:authTag:ciphertext` (hex). Each value stores its own
random IV; no IV reuse. `rawJson` migrated from `Json` (jsonb) to `String`/text.
`scripts/encrypt-existing-emails.ts`: idempotent backfill — 21 rows encrypted on first
run, all 21 skipped on second run. UI: `fromEmail`/`fromName` never rendered; shows
"Forwarded by you."

**Residual gap at time of shipping:** webhook still `console.log`s full plaintext Postmark
payload.

---

## ~2026-04-30 — Milestone 5: Pre-alpha privacy features

Commerce gate (`lib/classify.ts`): runs before any DB write. NOT_COMMERCE → return 200,
write nothing. Classifier errors fail open. Dashboard delete controls: `deleteOrder`
cascades (Reminder → Email → Order), `deleteEmail` removes email and cascades to empty
Order. `/settings` page: wipes all data behind typing `DELETE`. `/privacy` page.

---

## ~2026-04-25 — Milestone 4: Reminder engine

`Reminder` model: `@@unique([orderId, reminderType])` is the dedup mechanism. `lib/reminders.ts`:
`reminderTypeForOrder(order, today)` — pure function, no DB, no send. Returns
`"7_day"`, `"2_day"`, `"1_day"`, `"same_day"` or null. Daily cron at 14:00 UTC.
`CRON_SECRET` bearer auth. `?force=true` for testing. Skip statuses: `completed`,
`expired`, `return_started`. Subject format: `{daysLeftLabel} to return: {retailer} · {total}`.
DKIM/SPF/DMARC set up for `metaxmoda.com`; real scheduled run confirmed "1 day left to
return: SKIMS · $210" landed in inbox, not spam.

---

## ~2026-04-20 — Milestone 3: Order model + fuzzy order-number matching

`Order` model introduced. `Email.orderId` relation added. Dashboard queries `Order`, not
`Email`. `lib/linkOrder.ts`: match by retailer + orderNumber (case-insensitive, userId-scoped).
Merge rule: new non-null wins; null never erases. `resolveOrderTotal()`: order_confirmation
total is authoritative. Fallback `orderDate` from forwarded-message header. Fuzzy prefix
match (added post-Milestone 8): when exact match fails, checks prefix relationship (min 5
chars). Always forces `needsReview: true`. Added after Mango `F4VLSF` vs `F4VLSF00`
(ReBOUND appends digits) created two cards. Cleanup: orphan `F4VLSF00` Order deleted; two
return-confirmation emails re-extracted and re-linked onto `F4VLSF`. Confirmed `F4VLSG`
(unrelated Mango order) untouched.

---

## ~2026-04-15 — Milestone 2: AI extraction

Extraction fields added to `Email`. `lib/extract.ts`: Claude Sonnet extraction; web-search
policy lookup when retailer known but `returnWindowDays` null; `computeDeadline()`. Key
invariants: null + low confidence > wrong answer; retailer from body only; deadline
estimated when delivery date missing; order_confirmation total authoritative.

---

## ~2026-04-10 — Milestone 1: Email ingestion

Next.js App Router scaffold, Prisma + Neon, `POST /api/inbound` Postmark webhook, dashboard
listing received emails. Deployed to Vercel. Verified with a real forwarded H&M order
confirmation appearing on screen.

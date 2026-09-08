# Post-mortem: self-outbound guard's 3-day silent ingestion outage

**Incident window:** 2026-09-04T00:05 UTC – 2026-09-07 (guard deploy to fix
deploy). **Severity:** high — silently dropped an unknown-but-large fraction
of real, wanted commerce email across multiple users, with zero user-facing
error and zero internal alert. **Status:** fixed and deployed (`b316416`),
recovery complete for the known-affected population (`1e51fe2`, 106/106
processed clean). This document covers root cause, timeline, and why
detection took 3 days — no further fix work is proposed here.

---

## Root cause

Commit `22be2d7` (2026-09-03) added `lib/selfOutboundGuard.ts` to solve a
real, confirmed problem: Gmail auto-forward rules were routing this app's
own outbound emails (reminders, digests, refund check-ins) back into its own
inbound webhook, corrupting `Order.returnPortalUrl` with a self-referential
URL. Three conditions were shipped:

1. `from_domain` — From/envelope-sender domain matches our own. Confirmed
   against every real corrupted row before shipping.
2. `return_path_domain` — Return-Path header domain matches our own.
3. `header_chain_auto_forward` — `forwardType === "auto"` AND any header
   value contains our own root domain anywhere.

Condition 3's own code comment at the time it shipped: *"belt-and-suspenders
... in case (a) is ever defeated by a forwarding path that rewrites
From/Return-Path ... **Not expected to fire in current data**."* It was
speculative by its author's own admission, and **no test verified that
claim against real forwarded mail** before it shipped — the two diagnostics
that ran a week later found that claim was wrong: Gmail's own
`Return-Path` (VERP-encoded) and `X-Forwarded-To` headers embed the
forwarding *destination* — this app's own domain — on **every** email a
user auto-forwards to their inbound address, self-loop or not. Condition 3
couldn't distinguish "this is our own outbound mail looping back" from "this
is completely unrelated retailer mail the user forwarded us," because both
cases put our domain in the header chain by construction.

**The two diagnostics that found this (2026-09-07) confirmed condition 3
never caught anything condition 1 didn't already catch.** Of 87 sampled
discards, 85 (97.7%) were real retailer commerce email; the 2 genuine
loops were both caught independently by condition 1's `from_domain` check.

## Timeline

| When (UTC) | Event |
|---|---|
| 2026-09-02 | Original `returnPortalUrl` self-domain corruption confirmed (3 orders, 90-day lookback) — the problem the guard was built to solve |
| 2026-09-03T17:05:20-07:00 (= 2026-09-04T00:05:20Z) | Commit `22be2d7` authored: guard added with all 3 conditions |
| 2026-09-04T00:05:20Z | Guard deployed to production |
| 2026-09-04T00:22:50Z | **First false-positive discard** — 17 minutes after deploy |
| 2026-09-04 – 2026-09-06 | 118 `self_outbound_loop` `DiscardLog` rows accumulate. No alert fires. No dashboard surfaces the rate change. Discard rate for this reason goes from exactly zero (every day before the deploy) to constant (multiple per hour, every day after) |
| 2026-09-06 | An unrelated diagnostic session (orderDate origin investigation for Gap Order #1RYJR48) notices a side discrepancy: DB shows 2 linked emails, owner recalls 3 in their inbox. Noted, not chased that session |
| 2026-09-07 | Postmark ingestion diagnostic (following up on the noted discrepancy) traces the missing Gap email + a separately-noticed missing eBay order to **one** root cause: condition 3 |
| 2026-09-07 | Guard tradeoff diagnostic sizes the damage: 85/87 sampled discards were false positives, confirms condition 3's historical value was already fully covered by condition 1 |
| 2026-09-07 | Fix designed (Step 0 sending-address enumeration, verified against live production env vars) and shipped: condition 3 narrowed from "any header contains our domain" to "any header contains one of our two actual sending addresses" |
| 2026-09-07 | Fix deployed (`b316416`) |
| 2026-09-07 – 2026-09-08 | Recovery: founder pilot (21 approved, 12 processed for real before an unrelated process interruption), dry-run built and run over the remaining 106 eligible discards, real recovery run completes 106/106 clean, 0 errors |

**Total known blast radius:** 118 discards over the incident window; 106 of
those were confirmed eligible for recovery (12 already recovered in the
founder pilot, plus false-positive discards outside the two diagnostics'
sampling window may exist but weren't separately counted — see "What this
post-mortem does not claim," below).

## Why did this take 3 days to notice?

Three compounding gaps, each independently sufficient to delay detection:

1. **No observability on `DiscardLog`'s reason distribution.** The table
   exists (added 2026-07-26, for a different discard reason) and nothing
   reads it proactively. No dashboard, cron, or alert watches for a discard
   reason's rate changing shape — a reason going from "never happens" to
   "happens every 20-40 minutes, every day" for 3 straight days produced no
   signal anywhere a person would see it. The 118-row spike was only found
   because a diagnostic session queried `DiscardLog` directly, after the
   fact, in response to an unrelated symptom.

2. **The condition that caused it was never verified against real traffic
   before shipping.** The guard's own code comment flagged condition 3 as
   speculative ("not expected to fire") — that phrasing is itself a
   testable claim, and it was never tested. A single check at ship time —
   replay `detectSelfOutboundLoop()` against a sample of real, currently-
   flowing forwarded commerce email (exactly what the 2026-09-07 diagnostics
   eventually did, after the fact) — would have shown 97.7% of that sample
   tripping the new condition, before it ever reached production.

3. **Detection was incidental, not designed.** The chain that actually
   found this — an orderDate diagnostic noticing a side discrepancy, which
   prompted a follow-up ingestion diagnostic the next day — depended on a
   specific owner noticing a specific missing email in their own inbox and
   mentioning it. A user or retailer whose forwarded mail was silently
   dropped had no way to know it happened (no error, no bounce, no visible
   gap unless they were already comparing their inbox to the app by hand),
   and nothing in the system would have surfaced it on its own.

## What this post-mortem does not claim

- **Not a full audit of every affected user or every dropped email.** The
  118-discard count and the 106-eligible-for-recovery figure come from the
  two 2026-09-07 diagnostics' sampling methodology (timestamp-correlating
  `DiscardLog` rows to Postmark's inbound message list, since `DiscardLog`
  carries no `messageId`) — real, but bounded by that method's own coverage
  (~76-90% match rate depending on the sampling window; see the diagnostics
  themselves for exact figures). A `DiscardLog.messageId` column (filed
  below) would let a future incident like this be sized exactly, not
  estimated.
- **No claim about detection time for a hypothetical future incident of a
  different shape.** This post-mortem's prevention recommendations target
  the three specific gaps above; they don't constitute a general incident-
  response capability for this app.

## Prevention — what would have caught this faster

1. **Ship-time verification for any new discard/reject condition.** Before
   deploying a condition that can silently drop real user data, replay it
   against a sample of real current traffic (this app already has the
   Postmark API access to do this cheaply) and confirm the false-positive
   rate is acceptable — the exact check both 2026-09-07 diagnostics ran,
   just moved before the deploy instead of after.
2. **Observability on `DiscardLog`'s reason distribution over time**, even
   a simple day-over-day rate comparison per reason, would have flagged the
   zero-to-constant jump within hours instead of days.
3. **`DiscardLog.messageId` (nullable)** — the single highest-leverage
   schema change raised across this incident's diagnostics. Every
   correlation exercise in this incident (which messages were discarded,
   which users were affected, how many are recoverable) had to reconstruct
   identity by matching timestamps against Postmark's API after the fact.
   A direct foreign key removes that entire class of estimation.
4. Treat a code comment's own admission that a condition is speculative
   ("not expected to fire," "belt-and-suspenders," similar) as a flag
   requiring the verification in (1), not as a reason the condition is
   low-risk to ship as-is.

## Smaller follow-ups surfaced during the incident

These are tracked separately in TASKS.md 🟡 Next, not resolved here:

- `DiscardLog` schema: add `messageId` (nullable) — see Prevention #3 above.
- Email state-change audit trail (more than just `updatedAt`) — would have
  made the recovery run's cascade effects (status transitions, auto-archive)
  auditable after the fact instead of inferred from `updatedAt` timestamps.
- Condition 2 (`return_path_domain`) is ungated by `forwardType`, unlike
  condition 3 — untested during this incident specifically; worth a check
  that it can't misfire the same way condition 3 did, on a different header
  shape.
- General `linkOrder` chronology-aware merge fix — the recovery run's 16
  actual merges (vs. the dry-run's isolated-per-row estimate of 8) came out
  correct only because the messages happened to arrive/process in a
  favorable order within that run. `mergeEmailIntoOrder`'s "newer non-null
  wins" semantics have no actual chronology awareness for most fields
  (`orderDate` is the one exception, already fixed 2026-08-27) — a
  differently-ordered batch could silently let a stale value overwrite a
  correct one. Related to, but distinct from, an earlier-documented general
  out-of-order-extraction bug (Zara/Shopbop `orderDate` case, TASKS.md
  ~line 2401) — likely the same underlying gap in different fields.
- Delayed-notification-jobs audit: did any reminder or digest cron fire
  against silently-broken data during the 3-day window (2026-09-04 through
  09-07)? Not checked.
- "Shopbop ghost": a row appeared and got junked during this incident's
  investigation with no code path identified for the junking. Unresolved,
  needs its own scoped diagnostic — see TASKS.md for the write-up from the
  original investigation before re-deriving.
- `DryRunCache` cleanup lifecycle — already tracked as its own TASKS.md
  item; not duplicated here.
- TASKS.md pilot-count bookkeeping: the founder pilot's scope narrowed from
  24 (all owner-eligible discards) → 21 (after excluding 3 known test-store
  emails) → 12 (actually processed for real before an unrelated
  interruption) — three different numbers referring to the same pilot at
  different stages, worth a one-line clarifying note wherever it's cited
  going forward rather than a new investigation.

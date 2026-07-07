# Refund Verification Loop — Execution Plan

Status: **spec complete, not started.** When picked up, execute from this
document instead of re-deriving the design. See `TASKS.md` 🟡 Next for the
one-line pointer.

## Why

Bugs 9+10+11 made refund emails auto-advance `displayStatus` to `refunded`
when the retailer's email states a specific dollar amount. That trusts the
retailer's email — it doesn't confirm the money actually posted to the
user's card. This is Option B from the original task-board entry: a proper
signed-token "did it land?" loop, superseding the cheaper Option A (a bare
check-in email with no answer capture), which was never built. Option B was
gated on the signed-token infrastructure (`lib/actionToken.ts`,
`lib/actionLinks.ts`, the Archive-from-email endpoint/page pattern) —
that infrastructure shipped and is owner-verified in production (see
`TASKS.md` ✅ Done), so this is fully unblocked.

Relevant existing decision-log entries this plan follows:
- "Mark as refunded is available from email, with a two-tap confirmation" —
  the same compromised-inbox threat model applies here; same mitigation
  ladder (better copy → in-app-only confirm → remove from email) if misuse
  ever surfaces.
- "Archive is the general-purpose 'hide, but keep, and stop emailing'
  primitive" — this feature does NOT archive or otherwise silence an order;
  it only stops the *follow-up* cadence once an answer is captured.

## Data model changes

Add to `Order` in `prisma/schema.prisma`, next to `returnedAt`:

```prisma
// Set by the "Yes, it landed" signed-token tap in the refund check-in
// email chain. Terminal — once set, no further refund-verification
// follow-ups are sent (see lib/refundCheckin.ts). Does not itself change
// displayStatus; the endpoint that sets this also advances displayStatus
// to "refunded" in the same transaction, mirroring the in-app "Mark as
// refunded" button.
refundVerifiedAt DateTime?

// Set by the "No, still missing" signed-token tap. NOT terminal — the
// follow-up cadence keeps running after this is set (a dispute just means
// "not yet," not "give up"). Historical: once set, never cleared, even if
// refundVerifiedAt is set later — it's a true record that the user
// reported a delay at some point, useful for spotting retailers with a
// pattern of slow refunds.
refundDisputedAt DateTime?
```

Extend the `Reminder.reminderType` comment (currently missing
`"refund_checkin"`, which already exists in code but was never added to the
schema comment — fix this as a drive-by):

```
reminderType String // "7_day" | "2_day" | "1_day" | "same_day" |
                     // "weekly_coverage_check" | "refund_checkin" |
                     // "refund_followup_1" | "refund_followup_2" |
                     // "refund_followup_3"
```

Extend the `TokenRedemption.action` comment:

```
action String // "archive" | "returned" | "refunded" | "kept" | "unarchive" |
              // "refund_verified" | "refund_disputed"
```

Migration: `npx prisma migrate dev --name refund_verification_loop` — two
nullable columns, no backfill needed.

## New library files

Mirror the existing Archive pattern exactly (`lib/archiveAction.ts` /
`lib/archivePageState.ts`) — pure, DB-free decision functions, unit-tested
without a database, consistent with this project's established testing
convention.

**`lib/refundVerificationAction.ts`** — the POST-endpoint decision logic,
one function per action:

```ts
export type RefundVerificationOutcome = "order_state_changed" | "invalid" | "success";

export interface RefundVerificationOrderState {
  userId: string;
  displayStatus: string;
  deletedAt: Date | null;
}

// Shared guard: order must exist, not be soft-deleted, and the token's
// userId must match the order's owner (same internal-bug backstop as
// decideArchiveOutcome). Both refund_verified and refund_disputed use this.
function checkOrderState(
  order: RefundVerificationOrderState | null,
  payload: { userId: string },
): RefundVerificationOutcome | null // null = passed, caller proceeds

export function decideRefundVerifiedOutcome(
  order: RefundVerificationOrderState | null,
  payload: { userId: string },
): { outcome: RefundVerificationOutcome; shouldSetVerified: boolean; shouldAdvanceToRefunded: boolean }
// - order missing/deleted -> order_state_changed
// - userId mismatch -> invalid
// - displayStatus already "refunded" -> success, no-op (idempotent, same
//   treatment as archive's "already archived" case)
// - displayStatus is "returned" -> success, shouldSetVerified: true,
//   shouldAdvanceToRefunded: true
// - displayStatus is anything else (never reached "returned") ->
//   order_state_changed — the check-in email chain only ever gets sent
//   for orders that reached "returned", so this means the order's state
//   changed out from under the token some other way

export function decideRefundDisputedOutcome(
  order: RefundVerificationOrderState | null,
  payload: { userId: string },
): { outcome: RefundVerificationOutcome; shouldSetDisputed: boolean }
// - order missing/deleted -> order_state_changed
// - userId mismatch -> invalid
// - displayStatus already "refunded" -> success, no-op (verification
//   already landed some other way — e.g. user clicked "Yes" on an earlier
//   email in the chain — nothing to record)
// - displayStatus is "returned" -> success, shouldSetDisputed: true
// - anything else -> order_state_changed
```

**`lib/refundVerificationPageState.ts`** — mirrors
`lib/archivePageState.ts`'s `decideArchivePageState`: reads
`verifyToken()`'s result + an existing `TokenRedemption` lookup + the
`Order` row, returns one of `invalid | expired | already_used |
order_state_changed | confirm`. One shared function parameterized by
action (`"refund_verified" | "refund_disputed"`), since the state-machine
shape is identical to Archive's — only the copy on the `confirm` page
differs.

## New endpoints

Two new routes, each following `app/api/action/archive/route.ts` line for
line: POST-only (no GET handler — link-previewer defense), form-encoded
`token` + `csrf`, `verifyToken` → `verifyCsrfToken` → a
`prisma.$transaction` that creates the `TokenRedemption` row FIRST (so its
unique `tokenHash` constraint is the atomic single-use guarantee), then
conditionally updates `Order`, then writes `ActionLog`, then
Post/Redirect/Get (303) to a `done` page reading the outcome from the query
string.

- **`app/api/action/refund-verified/route.ts`** — `ACTION = "refund_verified"`.
  On success: `Order.update({ refundVerifiedAt: new Date(), displayStatus:
  "refunded", archivedAt: new Date() })` — mirrors the in-app "Mark as
  refunded" button's atomic auto-archive (same decision-log entry: refunded
  is the one manual transition that auto-archives, atomically, in the same
  write).
- **`app/api/action/refund-disputed/route.ts`** — `ACTION =
  "refund_disputed"`. On success: `Order.update({ refundDisputedAt: new
  Date() })` only. No status change, no archive — the follow-up cadence
  (below) keeps running.

## New pages

Four pages, mirroring `app/action/archive/page.tsx` +
`app/action/archive/done/page.tsx`:

- **`app/action/refund-verified/page.tsx`** — confirm page. "Did your
  refund for {retailer} land?" + order summary (reuse `OrderSummary`
  pattern from the Archive page) + one button, "Yes, it landed" → POST to
  `/api/action/refund-verified`.
- **`app/action/refund-verified/done/page.tsx`** — "Marked as refunded.
  Glad it landed." (+ order summary, "View in app →" link, matching
  Archive's done-page shape.)
- **`app/action/refund-disputed/page.tsx`** — confirm page. "Still missing
  your refund for {retailer}?" + order summary + one button, "No, still
  missing" → POST to `/api/action/refund-disputed`. Deliberately
  low-friction (one tap, no "are you sure") — this isn't a destructive or
  terminal action, same frictionless treatment as "Mark as returned" per
  the existing decision log (only "Mark as refunded" itself gets a confirm
  gate).
- **`app/action/refund-disputed/done/page.tsx`** — "Sorry to hear that."
  + retailer contact: link out to `order.returnPortalUrl` if present
  ("Contact {retailer} →"); if null, fallback copy: "Check your original
  order confirmation email for retailer contact info." + a line
  explaining what happens next: "We'll check back with you again in about
  a week." No explicit snooze button needed — the follow-up cron (below)
  is already going to re-ask on its own schedule; a manual snooze control
  would just duplicate that.

Both check-in and every follow-up email embed BOTH tokens (Yes and No) as
two `buildActionLink` calls — same helper Phase 5 already uses for the
Archive link in reminder/digest templates, no changes needed to
`lib/actionLinks.ts` itself.

## Cron / retry-cap logic

Extend `lib/refundCheckin.ts`. The existing `runRefundCheckinReminders`
(fires once, 5 or 10 days after `returnedAt`) becomes the *first* rung of a
4-email chain; add a sibling function for the follow-ups.

**Stop conditions (checked before sending any email in the chain):**
`displayStatus` must still be `"returned"` AND `refundVerifiedAt` must
still be `null`. Both the initial check-in and every follow-up query
already filter on `displayStatus: "returned"` (an order that reached
`refunded` — whether via the Yes-tap or the in-app button — naturally
drops out of every query in this chain with no extra flag needed).
`refundDisputedAt` being set does NOT stop the chain — a dispute means
"not yet," not "give up," so follow-ups continue on schedule regardless.

**Schedule (all relative to `returnedAt`, same anchor the existing
check-in uses):**

| Reminder type          | Fires (with tracking) | Fires (no tracking) |
|-------------------------|------------------------|-----------------------|
| `refund_checkin`        | +5 days  (existing)    | +10 days (existing)   |
| `refund_followup_1`     | +12 days               | +17 days              |
| `refund_followup_2`     | +19 days               | +24 days              |
| `refund_followup_3`     | +26 days               | +31 days              |

(Each follow-up is +7 days from the previous rung, anchored off
`returnedAt` rather than "7 days after the last email sent" — this keeps
the schedule computable in one query without needing to read the
`Reminder` table's timestamps, only its existence per type. Matches the
existing `refundCheckinSendAfter` pure-function style.)

**Cap enforcement:** there is no `refund_followup_4` — the chain simply
stops emitting anything once `refund_followup_3` has been sent (or its
window has passed with no response). This is enforced structurally (no
4th query branch exists), not by a counter field — same "the absence of a
case IS the cap" pattern as Archive's `already_used` handling.

**New pure functions in `lib/refundCheckin.ts`** (unit-tested, no DB),
following the existing `refundCheckinSendAfter` shape:

```ts
export const REFUND_FOLLOWUP_REMINDER_TYPES = [
  "refund_followup_1",
  "refund_followup_2",
  "refund_followup_3",
] as const;

export function refundFollowupSendAfter(
  returnedAt: Date,
  hasTracking: boolean,
  followupIndex: 1 | 2 | 3, // which rung
): Date

export function buildRefundFollowupBody(
  order: { retailer: string | null; lineItems: unknown; returnedAt: Date; id: string },
  followupIndex: 1 | 2 | 3,
  wasDisputed: boolean, // order.refundDisputedAt != null at send time — changes tone
  yesLink: string,
  noLink: string,
): string
```

**Wiring into the daily cron** (`app/api/cron/route.ts`, next to the
existing `runRefundCheckinReminders(today, fromEmail)` call): add
`runRefundFollowupReminders(today, fromEmail)`, same
sent/skipped/failed reporting shape as every other cron sub-task in that
file, same "one order's send failure doesn't block the rest" try/catch
per-order pattern already used throughout.

## Email copy

**Initial check-in** (`buildRefundCheckinBody` in `lib/refundCheckin.ts`)
gains the two token links. Updated body:

```
{retailer} / {item} was marked returned on {returnedDate} — has your
refund landed?

Yes, it landed: {yesLink}
No, still missing: {noLink}

View order: {APP_URL}/orders/{id}

— Return Window
```

Subject stays `"Worth checking your refund"` (unchanged — no reason to
touch a subject line that isn't part of this task).

**Follow-up 1** (tone: neutral nudge):
```
Following up on {retailer}{ / item} — it's been {N} days since your
return, and we haven't heard back on whether the refund landed.

Yes, it landed: {yesLink}
No, still missing: {noLink}

View order: {APP_URL}/orders/{id}

— Return Window
```

**Follow-up 2** (tone: same as 1, `wasDisputed` variant if the user
already tapped "No" earlier in the chain):
```
Still checking in on {retailer}{ / item} — you mentioned the refund
hadn't landed yet. Any update?

Yes, it landed now: {yesLink}
No, still nothing: {noLink}

View order: {APP_URL}/orders/{id}

— Return Window
```
(Non-disputed variant keeps follow-up 1's neutral phrasing, just updates
the day count.)

**Follow-up 3** (final rung — say so, since there's no follow-up 4):
```
Last check on {retailer}{ / item} — it's been {N} days since your
return. This is the last reminder we'll send on this one; if the refund
still hasn't landed, it may be worth contacting {retailer} directly.

Yes, it landed: {yesLink}
No, still missing: {noLink}

View order: {APP_URL}/orders/{id}

— Return Window
```

Subjects: `"Following up on your refund"` (followup 1 & 2),
`"Last check: has your refund landed?"` (followup 3).

## Testing / verification checklist

Matches how Phases 1–5 of the Archive slice were actually verified — unit
tests for every pure function, curl-verified endpoints against a
disposable test order in production, then a real end-to-end email
click-through from the owner's own inbox before calling anything done.

- [ ] Unit tests: `decideRefundVerifiedOutcome`, `decideRefundDisputedOutcome`
      (all branches: success, no-op/already-refunded, order_state_changed,
      invalid) — `__tests__/refundVerificationAction.test.ts`
- [ ] Unit tests: `refundFollowupSendAfter` (with/without tracking, all 3
      indices), `buildRefundFollowupBody` (disputed vs not, all 3 indices)
      — extend `__tests__/refundCheckin.test.ts` or equivalent
- [ ] Migration applied, schema comments updated
- [ ] `curl -X POST` against `/api/action/refund-verified` and
      `/api/action/refund-disputed` with a real signed token for a
      disposable test order — verify TokenRedemption row, ActionLog row,
      Order state change, and the 303 redirect target, before any real
      email goes out
- [ ] Confirm pages render correctly for all five states (confirm, invalid,
      expired, already_used, order_state_changed) — same states Archive's
      page already has to handle, reuse `MessagePage`
- [ ] End-to-end: a real disposable order reaching `returned`, check-in
      email received in the owner's own inbox, both links clickable,
      correct outcome each time
- [ ] Cron dry run: confirm follow-up schedule fires at the right offsets
      and stops after `refund_followup_3` — no live sends to alpha users
      without an explicit go-ahead (per the existing "confirm recipients
      before any email to real users, including forced cron runs" rule)

## Suggested execution phases

If picked up fresh, break this into phases the same size as the Archive
slice's Phases 1–5:

1. Schema migration + pure decision-logic files + unit tests
2. `refund-verified` endpoint + confirm/done pages, curl-verified
3. `refund-disputed` endpoint + confirm/done pages, curl-verified
4. Check-in email updated with both links; follow-up cron logic + email
   copy; wired into `app/api/cron/route.ts`
5. End-to-end verification against a real disposable order; owner
   hand-verification before marking done in `TASKS.md`

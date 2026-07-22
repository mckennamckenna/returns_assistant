// "kept" is deliberately tied with "returned", not ranked above "refunded" —
// this single choice is what makes both of the generic rank-gate call sites
// (PATCH /api/orders/:id/status and advanceDisplayStatus in app/actions.ts)
// enforce "reachable from ordered/shipped/return_requested, not from
// returned/refunded" for free, with no bespoke branching in either gate. See
// BUILD.md's displayStatus section for the full reasoning.
// "delivered" sits just above "shipped" and below every return-related rung
// — it's evidence about the package (has it arrived?), not a decision the
// user has made, so it must never rank at or above return_requested. See
// deriveDisplayStatus below for how it's derived (off deliveredAt, not off
// the triggering email's type).
export const DISPLAY_STATUS_RANK: Record<string, number> = {
  ordered: 1,
  shipped: 2,
  delivered: 3,
  return_requested: 4,
  returned: 5,
  kept: 5,
  refunded: 6,
};

export const ALLOWED_MANUAL_STATUSES = ["return_requested", "returned", "refunded", "kept"] as const;
export type ManualDisplayStatus = (typeof ALLOWED_MANUAL_STATUSES)[number];

export const DISPLAY_STATUS_LABELS: Record<string, string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  delivered: "Delivered",
  return_requested: "Return requested",
  returned: "Returned",
  refunded: "Refunded",
  kept: "Kept",
};

// Pure function — safe to test without DB or mocks.
// Returns the displayStatus that auto-derivation would produce given the
// current email types linked to an order. Never downgrades a status that
// has already been manually advanced (return_requested or higher).
//
// Auto-derivation ladder (highest wins):
//   refund (confirmed amount) → "refunded" (money's actually back — see below)
//   refund (no confirmed amount) → "returned"
//   return_label  → "return_requested" (retailer issued a label = return initiated)
//   deliveredAt != null → "delivered" (persisted evidence the package arrived —
//                  deliberately keyed off the DB field, not the triggering
//                  email's type, so the state is stable across later emails,
//                  not just true in the moment a "delivery" email is processed)
//   delivery / shipping_confirmation (no deliveredAt) → "shipped"
//   otherwise     → "ordered"
//
// "delivered" and "returnable" (the separate internal `status` field) are
// deliberately orthogonal: this badge answers "where's my package," not "has
// the user decided anything." An order with no delivery confirmation stays
// "shipped" — never fabricated as delivered just because it's returnable.
//
// hasConfirmedRefundAmount: whether any linked "refund" email states an
// explicit, confidently-identified refund amount (Email.refundAmount +
// refundAmountConfidence, distinct from orderTotal — lib/extract.ts).
// Retailers are frequently vague about refunds ("we're processing your
// refund") without confirming the money actually moved — that ambiguity is
// exactly what the product exists to catch, so it branches the target
// status instead of treating every refund email the same:
//   - confirmed amount → "refunded": chapter closed, auto-archives (via
//     buildStatusTransitionData), no further reminders.
//   - no confirmed amount → "returned": NOT archived, so the existing
//     refund check-in reminder (lib/refundCheckin.ts, cron-driven off
//     displayStatus === "returned") naturally nudges the user later to
//     verify the money actually landed. No extra "scheduling" code needed
//     — the cron's own query already covers this once the order is here.
//
// This check runs before the return_requested-or-higher early-return below
// (unlike the rest of the ladder) — a refund email must be able to advance
// an order past return_requested/returned, which no other auto-derivation
// signal is allowed to do. The final rank comparison (not the early-return)
// is what still protects against downgrade in both branches.
//
// "kept" is never auto-derived (it's a manual-only decision — nothing in the
// ladder below ever produces it), and it needs its own guard *before* the
// refund branch specifically: kept's rank ties with "returned", so a refund
// email arriving after a manual "kept" would otherwise compute
// refunded(5) > kept(4) and silently overwrite a one-way user decision — the
// refund branch is deliberately exempt from the rank-based downgrade
// protection that would otherwise stop this, so it needs an explicit block.
export function deriveDisplayStatus(
  emailTypes: string[],
  currentDisplayStatus: string,
  hasConfirmedRefundAmount: boolean = false,
  deliveredAt: Date | null = null,
): string {
  if (currentDisplayStatus === "kept") return "kept";

  const currentRank = DISPLAY_STATUS_RANK[currentDisplayStatus] ?? 0;

  if (emailTypes.includes("refund")) {
    const target = hasConfirmedRefundAmount ? "refunded" : "returned";
    return DISPLAY_STATUS_RANK[target] > currentRank ? target : currentDisplayStatus;
  }

  // If a user has manually advanced to return_requested/returned/refunded,
  // auto-derivation must never pull it back down.
  if (currentRank >= DISPLAY_STATUS_RANK.return_requested) return currentDisplayStatus;

  let derived: string;
  if (emailTypes.includes("return_label")) {
    derived = "return_requested";
  } else if (deliveredAt != null) {
    derived = "delivered";
  } else if (emailTypes.includes("shipping_confirmation") || emailTypes.includes("delivery")) {
    derived = "shipped";
  } else {
    derived = "ordered";
  }

  const derivedRank = DISPLAY_STATUS_RANK[derived];
  // Only advance, never downgrade.
  return derivedRank > currentRank ? derived : currentDisplayStatus;
}

// Pure function — safe to test without DB or mocks.
// Returns the exact `data` object for the single prisma.order.update() call
// that performs a manual status transition, so the atomic-write shape (and
// the "don't overwrite an existing archivedAt" edge case) is testable
// without needing a DB. Both app/actions.ts and the PATCH status route use
// this so the two implementations of the same transition contract can't
// silently drift apart.
//
// - "returned": sets returnedAt once, on first arrival (never resets it).
// - "refunded": auto-archives in the same write — refunded is "chapter
//   closed" under the email-first principle, same as a manual archive.
//   If the order is already archived, archivedAt is left out of the
//   returned object entirely (the caller's update() then doesn't touch the
//   column), so an existing archive timestamp is never overwritten.
//   Also backfills returnedAt if still null — the two manual endpoints
//   always gate "refunded" behind an existing "returned" status first, so
//   returnedAt is already set by the time they call this. But auto-derived
//   refunds (a confirmed-amount refund email, lib/displayStatus.ts's
//   deriveDisplayStatus) can jump straight here from an earlier status
//   without ever passing through "returned" — without this, returnedAt
//   would stay null forever for those orders.
// - "kept": same auto-archive shape as "refunded" (chapter closed, stop
//   reminders), plus sets keptAt once, on first arrival — parallel to
//   returnedAt, never reset. Never backfills returnedAt: kept is a distinct
//   terminal branch, not a stand-in for having actually returned anything.
export function buildStatusTransitionData(
  nextStatus: string,
  current: { returnedAt: Date | null; archivedAt: Date | null; keptAt?: Date | null },
): { displayStatus: string; returnedAt?: Date; archivedAt?: Date; keptAt?: Date } {
  const data: { displayStatus: string; returnedAt?: Date; archivedAt?: Date; keptAt?: Date } = {
    displayStatus: nextStatus,
  };

  if ((nextStatus === "returned" || nextStatus === "refunded") && !current.returnedAt) {
    data.returnedAt = new Date();
  }

  if ((nextStatus === "refunded" || nextStatus === "kept") && !current.archivedAt) {
    data.archivedAt = new Date();
  }

  if (nextStatus === "kept" && !current.keptAt) {
    data.keptAt = new Date();
  }

  return data;
}

// The teaching-copy confirm message shown before "Mark as refunded" commits.
// Refunded is one-way (no UI path back), and it auto-archives the order —
// both surprising enough consequences that the user should see them spelled
// out, not just be asked "are you sure?".
export const REFUND_CONFIRM_MESSAGE =
  "Mark this order as refunded? This closes the loop — no more reminders will fire for it, and it will move to your Archive (where you can still find it). Refunded status can't be undone from the UI.";

// Only "refunded" requires a confirm gate today — it's the one manual
// transition that's irreversible in the UI and has a side effect (archiving)
// the user might not expect. "return_requested" and "returned" stay
// frictionless: both are easily correctable if clicked by mistake.
// "kept" shares refunded's two confirm-triggering properties (irreversible,
// auto-archives) but deliberately does NOT get a blocking confirm — instead
// an always-visible inline caption (KEPT_WARNING_CAPTION below) states the
// consequence before the tap. No dollar amount is at stake the way refunded
// has, and the owner's call was that friction there isn't worth it.
export function requiresConfirmBeforeStatusChange(nextStatus: string): boolean {
  return nextStatus === "refunded";
}

// Inline warning shown beside/beneath the "I'm keeping this" button —
// visible before the tap, not a blocking dialog. See
// requiresConfirmBeforeStatusChange's comment above for why "kept" uses this
// instead of REFUND_CONFIRM_MESSAGE's window.confirm() pattern.
export const KEPT_WARNING_CAPTION = "This will stop all reminders for this order.";

export const DISPLAY_STATUS_RANK: Record<string, number> = {
  ordered: 1,
  shipped: 2,
  return_requested: 3,
  returned: 4,
  refunded: 5,
};

export const ALLOWED_MANUAL_STATUSES = ["return_requested", "returned", "refunded"] as const;
export type ManualDisplayStatus = (typeof ALLOWED_MANUAL_STATUSES)[number];

export const DISPLAY_STATUS_LABELS: Record<string, string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  return_requested: "Return requested",
  returned: "Returned",
  refunded: "Refunded",
};

// Pure function — safe to test without DB or mocks.
// Returns the displayStatus that auto-derivation would produce given the
// current email types linked to an order. Never downgrades a status that
// has already been manually advanced (return_requested or higher).
//
// Auto-derivation ladder (highest wins):
//   return_label  → "return_requested" (retailer issued a label = return initiated)
//   delivery      → "shipped" (delivery is a strict superset of having shipped)
//   shipping_confirmation → "shipped"
//   otherwise     → "ordered"
export function deriveDisplayStatus(emailTypes: string[], currentDisplayStatus: string): string {
  const currentRank = DISPLAY_STATUS_RANK[currentDisplayStatus] ?? 0;

  // If a user has manually advanced to return_requested/returned/refunded,
  // auto-derivation must never pull it back down.
  if (currentRank >= DISPLAY_STATUS_RANK.return_requested) return currentDisplayStatus;

  let derived: string;
  if (emailTypes.includes("return_label")) {
    derived = "return_requested";
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
export function buildStatusTransitionData(
  nextStatus: string,
  current: { returnedAt: Date | null; archivedAt: Date | null },
): { displayStatus: string; returnedAt?: Date; archivedAt?: Date } {
  const data: { displayStatus: string; returnedAt?: Date; archivedAt?: Date } = {
    displayStatus: nextStatus,
  };

  if (nextStatus === "returned" && !current.returnedAt) {
    data.returnedAt = new Date();
  }

  if (nextStatus === "refunded" && !current.archivedAt) {
    data.archivedAt = new Date();
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
export function requiresConfirmBeforeStatusChange(nextStatus: string): boolean {
  return nextStatus === "refunded";
}

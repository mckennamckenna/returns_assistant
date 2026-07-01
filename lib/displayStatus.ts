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

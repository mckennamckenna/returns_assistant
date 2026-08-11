// CARD_SPEC.md Part 3 — the needs-review bucket's v1 action registry (Q9):
// five actions, open/extensible, unknown-reason -> View detail, never throws.
export type NeedsReviewActionId = "link_to_order" | "create_new_order" | "not_a_purchase" | "view_detail" | "nothing";

export interface NeedsReviewActionSpec {
  id: NeedsReviewActionId;
  label: string;
}

// UI copy exactly as given in CARD_SPEC.md Part 3's table.
export const NEEDS_REVIEW_ACTION_LABELS: Record<NeedsReviewActionId, string> = {
  link_to_order: "Merge with existing order",
  create_new_order: "Start a new order",
  not_a_purchase: "Archive",
  view_detail: "More info",
  nothing: "Nothing",
};

export interface NeedsReviewRowInput {
  kind: "order" | "email";
  hasRetailer: boolean;
}

// Picks the ONE primary registered action for a row (slot 4 is singular —
// "the action," not a menu of five). An already-linked Order has nothing to
// manually link or create, so it degrades to View detail (Q9's explicit
// fallback) — this bucket doesn't invent a new "merge two orders" flow. An
// orphaned email with an extracted retailer has enough data to seed a fresh
// order; one with no retailer at all is the strongest available signal
// that it isn't a purchase.
export function needsReviewAction(row: NeedsReviewRowInput): NeedsReviewActionSpec {
  const id: NeedsReviewActionId =
    row.kind === "order" ? "view_detail" : row.hasRetailer ? "create_new_order" : "not_a_purchase";
  return { id, label: NEEDS_REVIEW_ACTION_LABELS[id] };
}

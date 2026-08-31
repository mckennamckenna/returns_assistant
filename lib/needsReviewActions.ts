import type { NeedsReviewReasonId } from "./needsReviewReasons";

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
  reasonId: NeedsReviewReasonId;
}

// CARD_SPEC.md Part 3's reason -> action mapping, routed on the row's
// actual detected reason (2026-08-21 rebuild — the 2026-08-11 build routed
// on kind + hasRetailer only and never consulted the reason at all).
//
// order-kind rows are already-merged Orders, not raw unlinked emails — the
// Link-to-order picker (app/LinkToOrderPicker.tsx) only attaches an
// unlinked emailId to an Order, it has no order-to-order merge capability.
// So belongs_to_existing_order/duplicate degrade to view_detail for
// order-kind rows even though the same reason maps to link_to_order for
// email-kind rows (2026-08-21 owner decision — real merge machinery is
// deferred, see TASKS.md 🟡 Next "Order-to-order merge action").
//
// not_a_purchase has no reason routed to it in this pass (not-e-commerce
// detection is out of cheap-version scope) but stays in the registry —
// Q9's open/extensible registry, unknown-reason-degrades-safely design.
export function needsReviewAction(row: NeedsReviewRowInput): NeedsReviewActionSpec {
  let id: NeedsReviewActionId;
  if (row.kind === "order") {
    id = "view_detail";
  } else if (
    row.reasonId === "belongs_to_existing_order" ||
    row.reasonId === "duplicate" ||
    row.reasonId === "return_or_refund_no_link" ||
    row.reasonId === "shipment_unlinked"
  ) {
    id = "link_to_order";
  } else if (row.reasonId === "real_purchase_no_record") {
    id = "create_new_order";
  } else {
    id = "view_detail";
  }
  return { id, label: NEEDS_REVIEW_ACTION_LABELS[id] };
}

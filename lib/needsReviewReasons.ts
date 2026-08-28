// CARD_SPEC.md Part 3's reason -> action table (2026-08-12, ea939b1) — the
// canonical reason vocabulary shared by order-kind (lib/orderReview.ts) and
// email-kind (lib/needsReviewRows.ts) bucket rows, and by the action router
// (lib/needsReviewActions.ts). Single source of truth so the two kinds of
// row and the action registry can't drift apart on what a reason is called.
//
// Cheap-version scope, owner-locked 2026-08-21: only belongs_to_existing_order
// and duplicate are DB-detected (no Anthropic call, no classifier). Full
// detection (not-e-commerce, and richer email-kind reasons) is deliberately
// out of scope this pass — see TASKS.md 🟡 Next follow-up.
// return_or_refund_no_link and no_extraction_signal added 2026-08-25 —
// NEEDS_REVIEW_ROUTING_DESIGN.md §2's four-branch tree build session.
// carrier_tracking_unlinked added 2026-08-28 — carrier-row-disposition
// Phase 3 (docs/design/carrier_row_disposition_20260828.md).
export type NeedsReviewReasonId =
  | "belongs_to_existing_order"
  | "duplicate"
  | "return_or_refund_no_link"
  | "real_purchase_no_record"
  | "no_extraction_signal"
  | "carrier_tracking_unlinked"
  | "missing_order_date"
  | "missing_order_total"
  | "uncertain_details";

// CARD_SPEC.md Part 3's exact sentences — "the authority for what a given
// `why` renders as, not a suggestion." Do not paraphrase.
//
// uncertain_details has no canonical spec sentence — Part 3's own "any
// unmapped reason" row only defines an action (View detail), not text.
// Reuses the existing in-app "We're not certain about some details on this
// order" copy verbatim rather than inventing new language (2026-08-21 owner
// sign-off) for the collapsed tail: unverified return portal, unconfirmed
// forward date, low extraction confidence, and the true no-signal fallback
// all render as this one sentence now instead of four separate ones.
export const NEEDS_REVIEW_REASON_TEXT: Record<NeedsReviewReasonId, string> = {
  belongs_to_existing_order: "We think this email belongs to an existing order.",
  duplicate: "This looks like a duplicate of another order.",
  return_or_refund_no_link: "This looks like a return or refund for an order we don't have on file.",
  real_purchase_no_record: "This looks like a real purchase with no order record.",
  no_extraction_signal: "We couldn't extract any details from this email.",
  carrier_tracking_unlinked: "This is a carrier tracking email — link it to the order it belongs to.",
  missing_order_date: "We couldn't find a purchase date — the deadline may be estimated.",
  missing_order_total: "We couldn't find the order total.",
  uncertain_details: "We're not certain about some details on this order.",
};

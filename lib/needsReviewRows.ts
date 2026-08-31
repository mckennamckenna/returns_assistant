import { computeOrderReviewReason, type ReviewOrderForLabel, type ReviewCandidateOrder } from "./orderReview";
import { NEEDS_REVIEW_REASON_TEXT, type NeedsReviewReasonId } from "./needsReviewReasons";

// CARD_SPEC.md Part 3 — one shared row shape for the bucket
// (app/NeedsReviewBucket.tsx) and its "View all" overflow page
// (app/(app)/needs-review/page.tsx), built once here so the two surfaces
// can't compute a row differently.
export interface NeedsReviewRowData {
  kind: "order" | "email";
  id: string;
  retailer: string | null;
  // Carrier display name ("FedEx", "USPS", ...) — only ever set for
  // email-kind rows (carrier-row-disposition Phase 1, 2026-08-28). Orders
  // are out of scope for carrier display.
  carrier: string | null;
  date: Date | null;
  amount: number | null;
  currency: string | null;
  why: string;
  reasonId: NeedsReviewReasonId;
}

// The active-orders list both kinds of row check DB-inspectable reasons
// against (does an email/mismatched order number match one of these?) —
// callers already compute this for the Link-to-order picker
// (app/LinkToOrderPicker.tsx's LinkablePickerOrder), same shape reused here.
export type CandidateOrder = ReviewCandidateOrder;

type ReviewOrderInput = ReviewOrderForLabel & {
  retailer: string | null;
  orderCurrency: string | null;
};

// "linked-but-flagged" / "duplicate" populations (CARD_SPEC.md Part 3) —
// needsReview Orders. Reason detection lives in
// lib/orderReview.ts's computeOrderReviewReason(); this build does not
// change *why* orders get flagged, only how the flag is displayed and
// which action it routes to.
export function orderReviewRow(order: ReviewOrderInput, candidateOrders: CandidateOrder[]): NeedsReviewRowData {
  const { reasonId, why } = computeOrderReviewReason(order, candidateOrders);
  return {
    kind: "order",
    id: order.id,
    retailer: order.retailer,
    carrier: null,
    date: order.orderDate,
    amount: order.orderTotal,
    currency: order.orderCurrency,
    why,
    reasonId,
  };
}

interface EmailReviewInput {
  id: string;
  retailer: string | null;
  carrier: string | null;
  receivedAt: Date;
  orderTotal: number | null;
  orderCurrency: string | null;
  orderNumber: string | null;
  emailType: string | null;
  retailerSource: string | null;
}

const RETURN_SIDE_EMAIL_TYPES = new Set(["return_label", "refund"]);
const PURCHASE_SIDE_EMAIL_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);

// Four-branch tree, checked in priority order — NEEDS_REVIEW_ROUTING_DESIGN.md
// §2, built 2026-08-25 after owner review. Supersedes the 2026-08-21
// single-branch version (exact orderNumber match, else unconditionally
// "real_purchase_no_record") — that fallback conflated "genuinely looks
// like a purchase, no exact number match" with "we have no idea what this
// is." No "duplicate" detection for email-kind rows this pass — still no
// canonical dedup key; see TASKS.md 🟡 Next for the full-detection follow-up.
function detectEmailReviewReason(email: EmailReviewInput, candidateOrders: CandidateOrder[]): NeedsReviewReasonId {
  if (email.orderNumber) {
    const normalized = email.orderNumber.toLowerCase();
    const matches = candidateOrders.some((order) => order.orderNumber && order.orderNumber.toLowerCase() === normalized);
    if (matches) return "belongs_to_existing_order";
  }
  if (email.emailType && RETURN_SIDE_EMAIL_TYPES.has(email.emailType)) {
    return "return_or_refund_no_link";
  }
  if (email.emailType && PURCHASE_SIDE_EMAIL_TYPES.has(email.emailType) && (email.retailer || email.orderNumber)) {
    return "real_purchase_no_record";
  }
  // carrier-row-disposition Phase 3 (2026-08-28): carrier rows have
  // retailer: null and orderNumber: null, so they fail branch 3's check and
  // would otherwise fall into the true-no-signal fallback below, which
  // degrades to "More info" with no link path. Peeled off here, checked
  // before the fallback, so the true no-signal population (nothing to go
  // on at all) is untouched.
  if (email.retailerSource === "carrier_deferred") {
    return "shipment_unlinked";
  }
  return "no_extraction_signal";
}

// "orphaned genuine-commerce emails" population (CARD_SPEC.md Part 3) —
// couldn't auto-link (lib/linkOrder.ts's linkEmailToOrder early-return: no
// retailer, or no orderNumber and not an orphaned-refund candidate).
export function emailReviewRow(email: EmailReviewInput, candidateOrders: CandidateOrder[]): NeedsReviewRowData {
  const reasonId = detectEmailReviewReason(email, candidateOrders);
  return {
    kind: "email",
    id: email.id,
    retailer: email.retailer,
    carrier: email.carrier,
    date: email.receivedAt,
    amount: email.orderTotal,
    currency: email.orderCurrency,
    why: NEEDS_REVIEW_REASON_TEXT[reasonId],
    reasonId,
  };
}

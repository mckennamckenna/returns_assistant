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
  receivedAt: Date;
  orderTotal: number | null;
  orderCurrency: string | null;
  orderNumber: string | null;
}

// Cheap-version scope (owner-locked 2026-08-21): the only DB-detected
// email-kind reason is an exact orderNumber match against an existing
// Order — everything else defaults to "real purchase, no order record,"
// which is definitionally true for this population (every row here is an
// unlinked email by construction: orderId is null). No "duplicate"
// detection for email-kind rows this pass — there's no canonical dedup key
// to check an orphaned email against another orphaned email (as opposed to
// an established Order), and inventing one wasn't part of the owner-locked
// scope; see TASKS.md 🟡 Next for the full-detection follow-up.
function detectEmailReviewReason(email: EmailReviewInput, candidateOrders: CandidateOrder[]): NeedsReviewReasonId {
  if (email.orderNumber) {
    const normalized = email.orderNumber.toLowerCase();
    const matches = candidateOrders.some((order) => order.orderNumber && order.orderNumber.toLowerCase() === normalized);
    if (matches) return "belongs_to_existing_order";
  }
  return "real_purchase_no_record";
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
    date: email.receivedAt,
    amount: email.orderTotal,
    currency: email.orderCurrency,
    why: NEEDS_REVIEW_REASON_TEXT[reasonId],
    reasonId,
  };
}

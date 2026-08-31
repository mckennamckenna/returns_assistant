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
// Same set as PURCHASE_SIDE_EMAIL_TYPES — order_confirmation included
// (widened 2026-08-30, TASKS.md 🔴 Now amendment; originally excluded in
// the same-day Stage 2 commit on the theory that an order_confirmation
// might be the first email for a genuinely new order). Reversed same day:
// a zero-candidate order_confirmation still reaches "Start a new order"
// via the picker's create-new escape hatch (Stage 4) — identical outcome
// to the old direct route — while an order_confirmation whose orderNumber
// extraction simply failed (owner: common while the product builds out,
// not rare) now gets a real chance to merge into its actual existing
// order instead of guaranteed-duplicating it (the finding-5 sibling bug).
// No downside found on the prerequisite grep — shouldAutoJunk (lib/junk.ts)
// already never auto-junks a purchase-side orphan regardless of type, and
// nothing else branches on an orphaned order_confirmation's emailType.
const SHIPMENT_EMAIL_TYPES = new Set(["delivery", "shipping_confirmation", "order_confirmation"]);

// True for both halves of the shipment_unlinked population: a carrier
// ping with no retailer at all (retailerSource === "carrier_deferred",
// e.g. a bare "USPS Tracking" sender), and a purchase-side email whose
// retailer DID resolve from the body (e.g. H&M via UPS, Poshmark via USPS,
// or an order_confirmation with a retailer but a failed orderNumber
// extraction) but has no order number to match against. Same user job
// either way — link this to an order, there's no order number to help
// you — so all of these collapse into one reasonId.
function isUnlinkedShipment(email: EmailReviewInput): boolean {
  return (
    email.retailerSource === "carrier_deferred" ||
    (!!email.emailType && SHIPMENT_EMAIL_TYPES.has(email.emailType) && !!email.retailer && !email.orderNumber)
  );
}

// Four-branch tree, checked in priority order — NEEDS_REVIEW_ROUTING_DESIGN.md
// §2, built 2026-08-25 after owner review. Supersedes the 2026-08-21
// single-branch version (exact orderNumber match, else unconditionally
// "real_purchase_no_record") — that fallback conflated "genuinely looks
// like a purchase, no exact number match" with "we have no idea what this
// is." No "duplicate" detection for email-kind rows this pass — still no
// canonical dedup key; see TASKS.md 🟡 Next for the full-detection follow-up.
//
// isUnlinkedShipment is checked BEFORE the real_purchase_no_record branch
// (2026-08-30 reshape) — it used to run only as a branch-4 fallback, which
// meant a delivery/shipping_confirmation email with a known retailer (H&M,
// Poshmark, ...) satisfied branch 3's own (retailer || orderNumber) check
// and got short-circuited to "Start a new order" before branch 4 was ever
// reached. Moving this check earlier is the actual fix — branch 4's old
// carrier_deferred-only gate never itself misfired, it just never got a
// chance to run for this population.
function detectEmailReviewReason(email: EmailReviewInput, candidateOrders: CandidateOrder[]): NeedsReviewReasonId {
  if (email.orderNumber) {
    const normalized = email.orderNumber.toLowerCase();
    const matches = candidateOrders.some((order) => order.orderNumber && order.orderNumber.toLowerCase() === normalized);
    if (matches) return "belongs_to_existing_order";
  }
  if (email.emailType && RETURN_SIDE_EMAIL_TYPES.has(email.emailType)) {
    return "return_or_refund_no_link";
  }
  if (isUnlinkedShipment(email)) {
    return "shipment_unlinked";
  }
  if (email.emailType && PURCHASE_SIDE_EMAIL_TYPES.has(email.emailType) && (email.retailer || email.orderNumber)) {
    return "real_purchase_no_record";
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

import { reviewReasonLabel } from "./orderReview";

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
}

type ReviewOrderInput = Parameters<typeof reviewReasonLabel>[0] & {
  id: string;
  orderDate: Date | null;
  orderCurrency: string | null;
};

// "linked-but-flagged" / "duplicate" populations (CARD_SPEC.md Part 3) —
// needsReview Orders. Reuses reviewReasonLabel() verbatim; this build does
// not change why these orders get flagged, only how the flag is displayed.
export function orderReviewRow(order: ReviewOrderInput): NeedsReviewRowData {
  return {
    kind: "order",
    id: order.id,
    retailer: order.retailer,
    date: order.orderDate,
    amount: order.orderTotal,
    currency: order.orderCurrency,
    why: reviewReasonLabel(order),
  };
}

interface EmailReviewInput {
  id: string;
  retailer: string | null;
  receivedAt: Date;
  orderTotal: number | null;
  orderCurrency: string | null;
}

// "orphaned genuine-commerce emails" population (CARD_SPEC.md Part 3) —
// couldn't auto-link (lib/linkOrder.ts's linkEmailToOrder early-return: no
// retailer, or no orderNumber and not an orphaned-refund candidate).
export function emailReviewRow(email: EmailReviewInput): NeedsReviewRowData {
  return {
    kind: "email",
    id: email.id,
    retailer: email.retailer,
    date: email.receivedAt,
    amount: email.orderTotal,
    currency: email.orderCurrency,
    why: "Couldn't automatically match this to an order.",
  };
}

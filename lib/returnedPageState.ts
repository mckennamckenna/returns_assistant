import type { VerifyResult, ActionTokenPayload } from "@/lib/actionToken";
import { ACTION_TOKEN_TTL_MS } from "@/lib/actionToken";
import { DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export interface ReturnedOrderDetails {
  retailer: string | null;
  orderNumber: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
  orderDate: Date | null;
  returnDeadline: Date | null;
  displayStatus: string;
}

export type ReturnedPageState =
  | { state: "invalid" }
  | { state: "expired"; expiredAt: Date }
  // order is nullable here and on order_state_changed below — the page still
  // shows retailer/orderNumber when the row exists (e.g. a soft-deleted
  // order still has them), null only when the order genuinely can't be
  // found at all. Same shape as ArchivePageState.
  | { state: "already_used"; redeemedAt: Date; order: ReturnedOrderDetails | null }
  | { state: "order_state_changed"; order: ReturnedOrderDetails | null }
  | { state: "confirm"; order: ReturnedOrderDetails };

export interface ReturnedOrderPreview extends ReturnedOrderDetails {
  userId: string;
  deletedAt: Date | null;
}

function toOrderDetails(order: ReturnedOrderPreview): ReturnedOrderDetails {
  const { retailer, orderNumber, orderTotal, orderCurrency, orderDate, returnDeadline, displayStatus } = order;
  return { retailer, orderNumber, orderTotal, orderCurrency, orderDate, returnDeadline, displayStatus };
}

// Pure — no DB access. The GET page (app/action/returned/page.tsx) fetches
// TokenRedemption/Order itself and passes the results in; this just decides
// what to render. Read-only by construction: unlike the POST endpoint, this
// never writes TokenRedemption or ActionLog — a page view must never look
// like a redemption attempt. Mirrors decideArchivePageState exactly, except
// for the rank-gate check below (Archive has no rank concept; "returned" does).
export function decideReturnedPageState(
  verifyResult: VerifyResult,
  redemption: { redeemedAt: Date } | null,
  order: ReturnedOrderPreview | null,
): ReturnedPageState {
  if (!verifyResult.valid) {
    if (verifyResult.reason === "expired") {
      const expiredAt = expiryDateFor(verifyResult.payload);
      return { state: "expired", expiredAt };
    }
    return { state: "invalid" };
  }

  if (redemption) {
    return { state: "already_used", redeemedAt: redemption.redeemedAt, order: order ? toOrderDetails(order) : null };
  }

  if (!order || order.deletedAt) {
    return { state: "order_state_changed", order: order ? toOrderDetails(order) : null };
  }

  // Same internal-bug defense as decideReturnedOutcome — a token whose
  // embedded userId doesn't match the order it points at should never
  // reach here, but if it somehow does, don't leak details: show the
  // generic invalid state, not a confirm page for the wrong order.
  if (order.userId !== verifyResult.payload.userId) {
    return { state: "invalid" };
  }

  // Unlike Archive, "returned" is a forward-only rank transition — if the
  // order already reached returned/refunded/kept since this token was
  // issued, this link's assumption no longer holds. Reported the same way
  // decideReturnedOutcome reports it: order_state_changed, not a distinct
  // "already_returned" page state.
  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  if (currentRank >= DISPLAY_STATUS_RANK.returned) {
    return { state: "order_state_changed", order: toOrderDetails(order) };
  }

  return { state: "confirm", order: toOrderDetails(order) };
}

function expiryDateFor(payload: ActionTokenPayload): Date {
  return new Date(payload.issuedAt + ACTION_TOKEN_TTL_MS);
}

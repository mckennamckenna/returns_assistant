import type { VerifyResult, ActionTokenPayload } from "@/lib/actionToken";
import { ACTION_TOKEN_TTL_MS } from "@/lib/actionToken";

export interface StartReturnOrderDetails {
  retailer: string | null;
  orderNumber: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
  orderDate: Date | null;
  returnDeadline: Date | null;
  displayStatus: string;
  returnPortalUrl: string | null;
}

export type StartReturnPageState =
  | { state: "invalid" }
  | { state: "expired"; expiredAt: Date }
  // order is nullable here and on order_state_changed below — the page still
  // shows retailer/orderNumber when the row exists, null only when the
  // order genuinely can't be found at all. Same shape as Archive/Returned.
  | { state: "already_used"; redeemedAt: Date; order: StartReturnOrderDetails | null }
  | { state: "order_state_changed"; order: StartReturnOrderDetails | null }
  // returnPortalUrl was cleared/changed since the email was sent — nothing
  // to send the user to. Distinct from order_state_changed: the order
  // itself is fine, just the portal link isn't there anymore.
  | { state: "no_portal"; order: StartReturnOrderDetails }
  | { state: "confirm"; order: StartReturnOrderDetails };

export interface StartReturnOrderPreview extends StartReturnOrderDetails {
  userId: string;
  deletedAt: Date | null;
}

function toOrderDetails(order: StartReturnOrderPreview): StartReturnOrderDetails {
  const {
    retailer,
    orderNumber,
    orderTotal,
    orderCurrency,
    orderDate,
    returnDeadline,
    displayStatus,
    returnPortalUrl,
  } = order;
  return { retailer, orderNumber, orderTotal, orderCurrency, orderDate, returnDeadline, displayStatus, returnPortalUrl };
}

// Pure — no DB access. The GET page (app/action/start-return/page.tsx)
// fetches TokenRedemption/Order itself and passes the results in; this
// just decides what to render. Read-only by construction: unlike the POST
// endpoint, this never writes TokenRedemption or ActionLog — a page view
// must never look like a redemption attempt. Mirrors decideReturnedPageState/
// decideArchivePageState, with an added no_portal branch since this action,
// unlike either of those, depends on a URL that can go missing independently
// of the order's own state.
export function decideStartReturnPageState(
  verifyResult: VerifyResult,
  redemption: { redeemedAt: Date } | null,
  order: StartReturnOrderPreview | null,
): StartReturnPageState {
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

  // Same internal-bug defense as decideReturnedPageState/decideArchivePageState.
  if (order.userId !== verifyResult.payload.userId) {
    return { state: "invalid" };
  }

  if (!order.returnPortalUrl) {
    return { state: "no_portal", order: toOrderDetails(order) };
  }

  return { state: "confirm", order: toOrderDetails(order) };
}

function expiryDateFor(payload: ActionTokenPayload): Date {
  return new Date(payload.issuedAt + ACTION_TOKEN_TTL_MS);
}

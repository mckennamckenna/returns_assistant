import type { VerifyResult, ActionTokenPayload } from "@/lib/actionToken";
import { ACTION_TOKEN_TTL_MS } from "@/lib/actionToken";

export type ArchivePageState =
  | { state: "invalid" }
  | { state: "expired"; expiredAt: Date }
  | { state: "already_used"; redeemedAt: Date }
  | { state: "order_state_changed" }
  | { state: "confirm"; retailer: string | null; orderNumber: string | null };

export interface ArchiveOrderPreview {
  userId: string;
  retailer: string | null;
  orderNumber: string | null;
  deletedAt: Date | null;
}

// Pure — no DB access. The GET page (app/action/archive/page.tsx) fetches
// TokenRedemption/Order itself and passes the results in; this just decides
// what to render. Read-only by construction: unlike the POST endpoint, this
// never writes TokenRedemption or ActionLog — a page view must never look
// like a redemption attempt.
export function decideArchivePageState(
  verifyResult: VerifyResult,
  redemption: { redeemedAt: Date } | null,
  order: ArchiveOrderPreview | null,
): ArchivePageState {
  if (!verifyResult.valid) {
    if (verifyResult.reason === "expired") {
      // verifyResult.payload only exists on this branch (VerifyResult's
      // "expired" variant carries it, "invalid" doesn't) — TypeScript
      // enforces this narrowing, so there's no risk of reading .payload
      // where it isn't there.
      const expiredAt = expiryDateFor(verifyResult.payload);
      return { state: "expired", expiredAt };
    }
    return { state: "invalid" };
  }

  if (redemption) {
    return { state: "already_used", redeemedAt: redemption.redeemedAt };
  }

  if (!order || order.deletedAt) {
    return { state: "order_state_changed" };
  }

  // Same internal-bug defense as decideArchiveOutcome (Phase 3) — a token
  // whose embedded userId doesn't match the order it points at should
  // never reach here, but if it somehow does, don't leak details: show
  // the generic invalid state, not a confirm page for the wrong order.
  if (order.userId !== verifyResult.payload.userId) {
    return { state: "invalid" };
  }

  // Already-archived is deliberately NOT its own state, matching
  // decideArchiveOutcome's Phase 3 reasoning: re-confirming an
  // already-archived order is a harmless idempotent POST, not worth a
  // sixth page state.
  return { state: "confirm", retailer: order.retailer, orderNumber: order.orderNumber };
}

function expiryDateFor(payload: ActionTokenPayload): Date {
  return new Date(payload.issuedAt + ACTION_TOKEN_TTL_MS);
}

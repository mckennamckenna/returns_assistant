// Pure decision logic for the "Mark returned" one-tap-from-email action —
// kept separate from app/api/action/returned/route.ts so it's unit-testable
// without a DB, matching this project's established convention (DB-touching
// code isn't unit-tested; the decision it makes is). Mirrors
// lib/archiveAction.ts's shape exactly.
import { DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export type ReturnedOutcome = "order_state_changed" | "invalid" | "success";

export interface ReturnedOrderState {
  userId: string;
  displayStatus: string;
  deletedAt: Date | null;
}

export function decideReturnedOutcome(
  order: ReturnedOrderState | null,
  payload: { userId: string },
): { outcome: ReturnedOutcome; shouldMarkReturned: boolean } {
  if (!order || order.deletedAt) {
    return { outcome: "order_state_changed", shouldMarkReturned: false };
  }

  // Defense against internal bugs, not just attackers — a token whose
  // embedded userId doesn't match the order it points at should never
  // reach here in a correct system, but if it somehow does, this is the
  // backstop. Same as decideArchiveOutcome.
  if (order.userId !== payload.userId) {
    return { outcome: "invalid", shouldMarkReturned: false };
  }

  // Unlike Archive (a reversible flag, where re-archiving is a harmless
  // idempotent no-op treated as success), "returned" is a forward-only rank
  // transition — the same gate the dashboard buttons and PATCH
  // /api/orders/:id/status already use (reject if the target rank isn't
  // strictly higher than current). If the order already reached returned,
  // refunded, or kept (all rank >= DISPLAY_STATUS_RANK.returned) since this
  // token was issued — e.g. the user already handled it from the dashboard,
  // or a confirmed-amount refund email auto-advanced it — the order's real
  // state has moved on from what this link assumed. Reported as
  // order_state_changed, not a distinct outcome, matching how Archive
  // already uses that outcome for "this token's assumption about the order
  // no longer holds."
  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  if (currentRank >= DISPLAY_STATUS_RANK.returned) {
    return { outcome: "order_state_changed", shouldMarkReturned: false };
  }

  return { outcome: "success", shouldMarkReturned: true };
}

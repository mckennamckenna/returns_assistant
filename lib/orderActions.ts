import { DISPLAY_STATUS_RANK } from "./displayStatus";
import { daysUntil } from "./reminders";

// Single source of truth for "which manual action buttons should be visible
// for this order right now" — both the dashboard/list card (OrderCard.tsx)
// and the order detail page call this, so they can't drift apart the way
// the detail page's separate "Start Return" link + "I'm returning this"
// button used to (visible together regardless of displayStatus, while the
// list card correctly gated on it — the "MANGO contradiction").
export interface VisibleOrderActions {
  canStartReturn: boolean;
  canMarkReturned: boolean;
  canKeep: boolean;
  canMarkRefunded: boolean;
}

export function getVisibleActions(
  order: { displayStatus: string; returnDeadline: Date | null },
  now: Date,
): VisibleOrderActions {
  const rank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;

  return {
    canStartReturn: rank < DISPLAY_STATUS_RANK.return_requested,
    canMarkReturned: order.displayStatus === "return_requested",
    canKeep: rank < DISPLAY_STATUS_RANK.returned && (order.returnDeadline == null || daysUntil(order.returnDeadline, now) >= 0),
    canMarkRefunded: order.displayStatus === "returned",
  };
}

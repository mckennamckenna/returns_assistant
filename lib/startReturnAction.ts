// Pure decision logic for the "Start return" one-tap-from-email action —
// kept separate from app/api/action/start-return/route.ts so it's
// unit-testable without a DB, matching this project's established
// convention (DB-touching code isn't unit-tested; the decision it makes
// is). Mirrors lib/archiveAction.ts's/lib/returnedAction.ts's shape.
import { DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export type StartReturnOutcome = "order_state_changed" | "invalid" | "no_portal" | "success";

export interface StartReturnOrderState {
  userId: string;
  displayStatus: string;
  deletedAt: Date | null;
  returnPortalUrl: string | null;
}

export function decideStartReturnOutcome(
  order: StartReturnOrderState | null,
  payload: { userId: string },
): { outcome: StartReturnOutcome; shouldMarkReturnRequested: boolean; returnPortalUrl: string | null } {
  if (!order || order.deletedAt) {
    return { outcome: "order_state_changed", shouldMarkReturnRequested: false, returnPortalUrl: null };
  }

  // Defense against internal bugs, not just attackers — same backstop as
  // decideReturnedOutcome/decideArchiveOutcome.
  if (order.userId !== payload.userId) {
    return { outcome: "invalid", shouldMarkReturnRequested: false, returnPortalUrl: null };
  }

  // returnPortalUrl is looked up fresh here, not trusted from the token
  // (the token never carries it) — it can have changed or been cleared
  // since the reminder email was sent. Without it there's nowhere to send
  // the user, so the action can't complete.
  if (!order.returnPortalUrl) {
    return { outcome: "no_portal", shouldMarkReturnRequested: false, returnPortalUrl: null };
  }

  // Unlike "returned" (a one-way rank gate that reports a stale link as
  // order_state_changed), reaching the retailer's return portal stays
  // useful no matter how far the order's status has already advanced —
  // re-clicking an old Start-return link should still open the portal.
  // Idempotent like Archive: only the DB write is conditional on rank,
  // never the outcome itself.
  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  const shouldMarkReturnRequested = DISPLAY_STATUS_RANK.return_requested > currentRank;

  return { outcome: "success", shouldMarkReturnRequested, returnPortalUrl: order.returnPortalUrl };
}

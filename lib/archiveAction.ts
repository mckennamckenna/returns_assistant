// Pure decision logic for the Archive one-tap-from-email action — kept
// separate from app/api/action/archive/route.ts so it's unit-testable
// without a DB, matching this project's established convention (DB-touching
// code isn't unit-tested; the decision it makes is).
export type ArchiveOutcome = "order_state_changed" | "invalid" | "success";

export interface ArchiveOrderState {
  userId: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
}

export function decideArchiveOutcome(
  order: ArchiveOrderState | null,
  payload: { userId: string },
): { outcome: ArchiveOutcome; shouldArchive: boolean } {
  if (!order || order.deletedAt) {
    return { outcome: "order_state_changed", shouldArchive: false };
  }

  // Defense against internal bugs, not just attackers — a token whose
  // embedded userId doesn't match the order it points at should never
  // reach here in a correct system, but if it somehow does, this is the
  // backstop.
  if (order.userId !== payload.userId) {
    return { outcome: "invalid", shouldArchive: false };
  }

  // Already archived is treated as "success", not a distinct outcome —
  // the idempotent no-op case IS the desired end state (the requester's
  // intent is fulfilled whether this call archived it or an earlier one
  // did). If the archived-now vs. archived-earlier distinction is ever
  // needed, it's reconstructable from ActionLog(outcome: success) joined
  // against Order's state at that time — no schema change required.
  if (order.archivedAt) {
    return { outcome: "success", shouldArchive: false };
  }

  return { outcome: "success", shouldArchive: true };
}

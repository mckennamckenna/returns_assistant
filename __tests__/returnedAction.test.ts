import { describe, it, expect } from "vitest";
import { decideReturnedOutcome } from "../lib/returnedAction";

describe("decideReturnedOutcome", () => {
  it("returns order_state_changed when the order doesn't exist", () => {
    const result = decideReturnedOutcome(null, { userId: "user_1" });
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturned: false });
  });

  it("returns order_state_changed when the order was deleted since the token was issued", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "shipped", deletedAt: new Date() },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturned: false });
  });

  it("returns invalid when the order's userId doesn't match the token's (internal-bug defense)", () => {
    const result = decideReturnedOutcome(
      { userId: "user_2", displayStatus: "shipped", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "invalid", shouldMarkReturned: false });
  });

  it("checks deletedAt/missing-order before the userId mismatch", () => {
    // A deleted order with a mismatched userId should still report
    // order_state_changed, not invalid — deletion is checked first.
    const result = decideReturnedOutcome(
      { userId: "user_2", displayStatus: "shipped", deletedAt: new Date() },
      { userId: "user_1" },
    );
    expect(result.outcome).toBe("order_state_changed");
  });

  // ── Status-gate: only valid below the "returned" rank ─────────────────────
  // Unlike Archive (idempotent no-op when re-archiving), "returned" is a
  // forward-only rank transition — the same gate the dashboard buttons and
  // PATCH /api/orders/:id/status already use.

  it("returns success with shouldMarkReturned: true from 'ordered'", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "ordered", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturned: true });
  });

  it("returns success with shouldMarkReturned: true from 'shipped'", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "shipped", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturned: true });
  });

  it("returns success with shouldMarkReturned: true from 'return_requested'", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "return_requested", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturned: true });
  });

  it("returns order_state_changed when already 'returned' — does not re-mark", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "returned", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturned: false });
  });

  it("returns order_state_changed when already 'refunded' — does not downgrade", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "refunded", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturned: false });
  });

  it("returns order_state_changed when already 'kept' — a stale reminder link must not override a manual kept decision", () => {
    const result = decideReturnedOutcome(
      { userId: "user_1", displayStatus: "kept", deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturned: false });
  });
});

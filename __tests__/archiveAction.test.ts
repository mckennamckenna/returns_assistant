import { describe, it, expect } from "vitest";
import { decideArchiveOutcome } from "../lib/archiveAction";

describe("decideArchiveOutcome", () => {
  it("returns order_state_changed when the order doesn't exist", () => {
    const result = decideArchiveOutcome(null, { userId: "user_1" });
    expect(result).toEqual({ outcome: "order_state_changed", shouldArchive: false });
  });

  it("returns order_state_changed when the order was deleted since the token was issued", () => {
    const result = decideArchiveOutcome(
      { userId: "user_1", archivedAt: null, deletedAt: new Date() },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldArchive: false });
  });

  it("returns invalid when the order's userId doesn't match the token's (internal-bug defense)", () => {
    const result = decideArchiveOutcome(
      { userId: "user_2", archivedAt: null, deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "invalid", shouldArchive: false });
  });

  it("returns success with shouldArchive: false when the order is already archived (idempotent no-op)", () => {
    const result = decideArchiveOutcome(
      { userId: "user_1", archivedAt: new Date(), deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldArchive: false });
  });

  it("returns success with shouldArchive: true for a fresh archive", () => {
    const result = decideArchiveOutcome(
      { userId: "user_1", archivedAt: null, deletedAt: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldArchive: true });
  });

  it("checks deletedAt/missing-order before the userId mismatch", () => {
    // A deleted order with a mismatched userId should still report
    // order_state_changed, not invalid — deletion is checked first.
    const result = decideArchiveOutcome(
      { userId: "user_2", archivedAt: null, deletedAt: new Date() },
      { userId: "user_1" },
    );
    expect(result.outcome).toBe("order_state_changed");
  });
});

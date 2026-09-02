import { describe, it, expect } from "vitest";
import { decideStartReturnOutcome } from "../lib/startReturnAction";

describe("decideStartReturnOutcome", () => {
  it("returns order_state_changed when the order doesn't exist", () => {
    const result = decideStartReturnOutcome(null, { userId: "user_1" });
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturnRequested: false, returnPortalUrl: null });
  });

  it("returns order_state_changed when the order was deleted since the token was issued", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "shipped", deletedAt: new Date(), returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "order_state_changed", shouldMarkReturnRequested: false, returnPortalUrl: null });
  });

  it("returns invalid when the order's userId doesn't match the token's (internal-bug defense)", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_2", displayStatus: "shipped", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "invalid", shouldMarkReturnRequested: false, returnPortalUrl: null });
  });

  it("checks deletedAt/missing-order before the userId mismatch", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_2", displayStatus: "shipped", deletedAt: new Date(), returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result.outcome).toBe("order_state_changed");
  });

  it("returns no_portal when returnPortalUrl has gone missing since the token was issued", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "shipped", deletedAt: null, returnPortalUrl: null },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "no_portal", shouldMarkReturnRequested: false, returnPortalUrl: null });
  });

  it("returns success with shouldMarkReturnRequested: true from 'ordered'", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "ordered", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturnRequested: true, returnPortalUrl: "https://hm.com/returns" });
  });

  it("returns success with shouldMarkReturnRequested: true from 'shipped'", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "shipped", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturnRequested: true, returnPortalUrl: "https://hm.com/returns" });
  });

  // Unlike "returned" (a one-way rank gate reporting a stale link as
  // order_state_changed), reaching the retailer's portal stays useful
  // regardless of how far the order has already advanced — idempotent
  // like Archive: the outcome is still success, only the write is
  // conditional on rank.

  it("returns success with shouldMarkReturnRequested: false when already 'return_requested' — idempotent, still redirects", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "return_requested", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturnRequested: false, returnPortalUrl: "https://hm.com/returns" });
  });

  it("returns success with shouldMarkReturnRequested: false when already 'returned' — does not downgrade, still redirects", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "returned", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturnRequested: false, returnPortalUrl: "https://hm.com/returns" });
  });

  it("returns success with shouldMarkReturnRequested: false when already 'kept' — a stale link must not override a manual kept decision", () => {
    const result = decideStartReturnOutcome(
      { userId: "user_1", displayStatus: "kept", deletedAt: null, returnPortalUrl: "https://hm.com/returns" },
      { userId: "user_1" },
    );
    expect(result).toEqual({ outcome: "success", shouldMarkReturnRequested: false, returnPortalUrl: "https://hm.com/returns" });
  });
});

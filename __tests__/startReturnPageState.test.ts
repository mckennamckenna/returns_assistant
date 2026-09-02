import { describe, it, expect } from "vitest";
import { decideStartReturnPageState, type StartReturnOrderPreview } from "../lib/startReturnPageState";
import { ACTION_TOKEN_TTL_MS, type VerifyResult } from "../lib/actionToken";

const PAYLOAD = { orderId: "order_1", userId: "user_1", action: "start-return", issuedAt: 1700000000000 };

function makeOrder(overrides: Partial<StartReturnOrderPreview> = {}): StartReturnOrderPreview {
  return {
    userId: "user_1",
    retailer: "H&M",
    orderNumber: "123",
    orderTotal: 45.99,
    orderCurrency: "USD",
    orderDate: new Date("2026-06-01T00:00:00Z"),
    returnDeadline: new Date("2026-07-15T00:00:00Z"),
    displayStatus: "shipped",
    returnPortalUrl: "https://hm.com/returns",
    deletedAt: null,
    ...overrides,
  };
}

describe("decideStartReturnPageState", () => {
  it("returns invalid for an invalid verify result", () => {
    const result: VerifyResult = { valid: false, reason: "invalid" };
    expect(decideStartReturnPageState(result, null, null)).toEqual({ state: "invalid" });
  });

  it("computes expiredAt from the expired result's payload.issuedAt + TTL, with no order details", () => {
    const result: VerifyResult = { valid: false, reason: "expired", payload: PAYLOAD };
    const state = decideStartReturnPageState(result, null, makeOrder());

    expect(state.state).toBe("expired");
    if (state.state === "expired") {
      expect(state.expiredAt.getTime()).toBe(PAYLOAD.issuedAt + ACTION_TOKEN_TTL_MS);
    }
    expect(state).not.toHaveProperty("order");
  });

  it("returns already_used with order details when a TokenRedemption row already exists", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const redeemedAt = new Date("2026-01-01T00:00:00Z");
    const order = makeOrder();
    const state = decideStartReturnPageState(result, { redeemedAt }, order);

    expect(state).toEqual({
      state: "already_used",
      redeemedAt,
      order: {
        retailer: "H&M",
        orderNumber: "123",
        orderTotal: 45.99,
        orderCurrency: "USD",
        orderDate: order.orderDate,
        returnDeadline: order.returnDeadline,
        displayStatus: "shipped",
        returnPortalUrl: "https://hm.com/returns",
      },
    });
  });

  it("returns already_used with order: null when the order can't be found at all", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const redeemedAt = new Date("2026-01-01T00:00:00Z");
    expect(decideStartReturnPageState(result, { redeemedAt }, null)).toEqual({
      state: "already_used",
      redeemedAt,
      order: null,
    });
  });

  it("returns order_state_changed with order: null when the order is missing", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    expect(decideStartReturnPageState(result, null, null)).toEqual({ state: "order_state_changed", order: null });
  });

  it("returns order_state_changed with order details when the order was deleted (row still exists)", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ deletedAt: new Date() });
    const state = decideStartReturnPageState(result, null, order);

    expect(state.state).toBe("order_state_changed");
    if (state.state === "order_state_changed") {
      expect(state.order?.retailer).toBe("H&M");
      expect(state.order?.orderNumber).toBe("123");
    }
  });

  it("returns invalid (no order details) when the order's userId doesn't match the token's", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ userId: "user_2" });
    expect(decideStartReturnPageState(result, null, order)).toEqual({ state: "invalid" });
  });

  it("returns no_portal when returnPortalUrl has gone missing since the token was issued", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ returnPortalUrl: null });
    const state = decideStartReturnPageState(result, null, order);
    expect(state.state).toBe("no_portal");
    if (state.state === "no_portal") {
      expect(state.order.retailer).toBe("H&M");
    }
  });

  it("returns confirm with full order details for a valid, unredeemed order with a portal URL", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder();
    expect(decideStartReturnPageState(result, null, order)).toEqual({
      state: "confirm",
      order: {
        retailer: "H&M",
        orderNumber: "123",
        orderTotal: 45.99,
        orderCurrency: "USD",
        orderDate: order.orderDate,
        returnDeadline: order.returnDeadline,
        displayStatus: "shipped",
        returnPortalUrl: "https://hm.com/returns",
      },
    });
  });

  // Unlike decideReturnedPageState, there's no rank gate here — a stale
  // link (order already return_requested/returned/etc.) still confirms,
  // since reaching the retailer's portal stays useful regardless of the
  // order's own status. Mirrors decideStartReturnOutcome's idempotent
  // shape.
  it("still returns confirm (not order_state_changed) when already 'returned'", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ displayStatus: "returned" });
    expect(decideStartReturnPageState(result, null, order).state).toBe("confirm");
  });
});

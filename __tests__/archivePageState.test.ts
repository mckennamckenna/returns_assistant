import { describe, it, expect } from "vitest";
import { decideArchivePageState, type ArchiveOrderPreview } from "../lib/archivePageState";
import { ACTION_TOKEN_TTL_MS, type VerifyResult } from "../lib/actionToken";

const PAYLOAD = { orderId: "order_1", userId: "user_1", action: "archive", issuedAt: 1700000000000 };

function makeOrder(overrides: Partial<ArchiveOrderPreview> = {}): ArchiveOrderPreview {
  return {
    userId: "user_1",
    retailer: "H&M",
    orderNumber: "123",
    orderTotal: 45.99,
    orderCurrency: "USD",
    orderDate: new Date("2026-06-01T00:00:00Z"),
    returnDeadline: new Date("2026-07-15T00:00:00Z"),
    displayStatus: "shipped",
    deletedAt: null,
    ...overrides,
  };
}

describe("decideArchivePageState", () => {
  it("returns invalid for an invalid verify result", () => {
    const result: VerifyResult = { valid: false, reason: "invalid" };
    expect(decideArchivePageState(result, null, null)).toEqual({ state: "invalid" });
  });

  // Note 1's concern, directly: Phase 3 made VerifyResult's expired branch
  // carry the decoded payload. This confirms decideArchivePageState actually
  // reads it (issuedAt + TTL) rather than treating expired as payload-less —
  // if it didn't, this would either throw (payload undefined) or compute an
  // expiredAt from nothing.
  it("computes expiredAt from the expired result's payload.issuedAt + TTL, with no order details", () => {
    const result: VerifyResult = { valid: false, reason: "expired", payload: PAYLOAD };
    const state = decideArchivePageState(result, null, makeOrder());

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
    const state = decideArchivePageState(result, { redeemedAt }, order);

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
      },
    });
  });

  it("returns already_used with order: null when the order can't be found at all", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const redeemedAt = new Date("2026-01-01T00:00:00Z");
    expect(decideArchivePageState(result, { redeemedAt }, null)).toEqual({
      state: "already_used",
      redeemedAt,
      order: null,
    });
  });

  it("returns order_state_changed with order: null when the order is missing", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    expect(decideArchivePageState(result, null, null)).toEqual({ state: "order_state_changed", order: null });
  });

  it("returns order_state_changed with order details when the order was deleted (row still exists)", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ deletedAt: new Date() });
    const state = decideArchivePageState(result, null, order);

    expect(state.state).toBe("order_state_changed");
    if (state.state === "order_state_changed") {
      expect(state.order?.retailer).toBe("H&M");
      expect(state.order?.orderNumber).toBe("123");
    }
  });

  it("returns invalid (no order details) when the order's userId doesn't match the token's", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder({ userId: "user_2" });
    expect(decideArchivePageState(result, null, order)).toEqual({ state: "invalid" });
  });

  it("returns confirm with full order details for a valid, unredeemed, matching order", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder();
    expect(decideArchivePageState(result, null, order)).toEqual({
      state: "confirm",
      order: {
        retailer: "H&M",
        orderNumber: "123",
        orderTotal: 45.99,
        orderCurrency: "USD",
        orderDate: order.orderDate,
        returnDeadline: order.returnDeadline,
        displayStatus: "shipped",
      },
    });
  });

  it("returns confirm (not a distinct state) even when the order is already archived", () => {
    // decideArchivePageState doesn't take archivedAt at all — already-archived
    // isn't checked here, matching Phase 3's decideArchiveOutcome reasoning.
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = makeOrder();
    expect(decideArchivePageState(result, null, order).state).toBe("confirm");
  });
});

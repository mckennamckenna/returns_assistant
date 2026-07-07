import { describe, it, expect } from "vitest";
import { decideArchivePageState } from "../lib/archivePageState";
import { ACTION_TOKEN_TTL_MS, type VerifyResult } from "../lib/actionToken";

const PAYLOAD = { orderId: "order_1", userId: "user_1", action: "archive", issuedAt: 1700000000000 };

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
  it("computes expiredAt from the expired result's payload.issuedAt + TTL", () => {
    const result: VerifyResult = { valid: false, reason: "expired", payload: PAYLOAD };
    const state = decideArchivePageState(result, null, null);

    expect(state.state).toBe("expired");
    if (state.state === "expired") {
      expect(state.expiredAt.getTime()).toBe(PAYLOAD.issuedAt + ACTION_TOKEN_TTL_MS);
    }
  });

  it("returns already_used when a TokenRedemption row already exists, regardless of order state", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const redeemedAt = new Date("2026-01-01T00:00:00Z");
    const state = decideArchivePageState(result, { redeemedAt }, null);

    expect(state).toEqual({ state: "already_used", redeemedAt });
  });

  it("returns order_state_changed when the order is missing", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    expect(decideArchivePageState(result, null, null)).toEqual({ state: "order_state_changed" });
  });

  it("returns order_state_changed when the order was deleted", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = { userId: "user_1", retailer: "H&M", orderNumber: "123", deletedAt: new Date() };
    expect(decideArchivePageState(result, null, order)).toEqual({ state: "order_state_changed" });
  });

  it("returns invalid when the order's userId doesn't match the token's", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = { userId: "user_2", retailer: "H&M", orderNumber: "123", deletedAt: null };
    expect(decideArchivePageState(result, null, order)).toEqual({ state: "invalid" });
  });

  it("returns confirm with retailer/orderNumber for a valid, unredeemed, matching order", () => {
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = { userId: "user_1", retailer: "H&M", orderNumber: "123", deletedAt: null };
    expect(decideArchivePageState(result, null, order)).toEqual({
      state: "confirm",
      retailer: "H&M",
      orderNumber: "123",
    });
  });

  it("returns confirm (not a distinct state) even when order.archivedAt would already be set", () => {
    // decideArchivePageState doesn't take archivedAt at all — already-archived
    // isn't checked here, matching Phase 3's decideArchiveOutcome reasoning.
    const result: VerifyResult = { valid: true, payload: PAYLOAD };
    const order = { userId: "user_1", retailer: "H&M", orderNumber: "123", deletedAt: null };
    expect(decideArchivePageState(result, null, order).state).toBe("confirm");
  });
});

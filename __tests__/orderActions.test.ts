import { describe, it, expect } from "vitest";
import { getVisibleActions } from "../lib/orderActions";

const now = new Date("2026-07-13T12:00:00Z");
const future = new Date("2026-08-01T00:00:00Z");
const past = new Date("2026-06-01T00:00:00Z");

describe("getVisibleActions", () => {
  it("ordered: can start return and keep, cannot mark returned/refunded", () => {
    const actions = getVisibleActions({ displayStatus: "ordered", returnDeadline: future }, now);
    expect(actions).toEqual({
      canStartReturn: true,
      canMarkReturned: false,
      canKeep: true,
      canMarkRefunded: false,
    });
  });

  it("shipped: same shape as ordered", () => {
    const actions = getVisibleActions({ displayStatus: "shipped", returnDeadline: future }, now);
    expect(actions.canStartReturn).toBe(true);
    expect(actions.canMarkReturned).toBe(false);
    expect(actions.canKeep).toBe(true);
    expect(actions.canMarkRefunded).toBe(false);
  });

  // "delivered" (lib/displayStatus.ts) sits between shipped and
  // return_requested in rank — this proves inserting that new rung didn't
  // disturb the existing threshold-based gating (canStartReturn/canKeep are
  // still available, same as shipped/ordered; auto-archive gating in
  // lib/autoArchive.ts is covered separately in autoArchive.test.ts).
  it("delivered: same shape as shipped — the new rung doesn't disturb gating", () => {
    const actions = getVisibleActions({ displayStatus: "delivered", returnDeadline: future }, now);
    expect(actions.canStartReturn).toBe(true);
    expect(actions.canMarkReturned).toBe(false);
    expect(actions.canKeep).toBe(true);
    expect(actions.canMarkRefunded).toBe(false);
  });

  it("return_requested: can mark returned or still back out and keep it, but not start return again", () => {
    const actions = getVisibleActions({ displayStatus: "return_requested", returnDeadline: future }, now);
    expect(actions).toEqual({
      canStartReturn: false,
      canMarkReturned: true,
      canKeep: true,
      canMarkRefunded: false,
    });
  });

  it("returned: can only mark refunded", () => {
    const actions = getVisibleActions({ displayStatus: "returned", returnDeadline: future }, now);
    expect(actions).toEqual({
      canStartReturn: false,
      canMarkReturned: false,
      canKeep: false,
      canMarkRefunded: true,
    });
  });

  it("kept / refunded: no actions available", () => {
    expect(getVisibleActions({ displayStatus: "kept", returnDeadline: future }, now)).toEqual({
      canStartReturn: false,
      canMarkReturned: false,
      canKeep: false,
      canMarkRefunded: false,
    });
    expect(getVisibleActions({ displayStatus: "refunded", returnDeadline: future }, now)).toEqual({
      canStartReturn: false,
      canMarkReturned: false,
      canKeep: false,
      canMarkRefunded: false,
    });
  });

  it("canKeep is false once the return deadline has passed", () => {
    const actions = getVisibleActions({ displayStatus: "ordered", returnDeadline: past }, now);
    expect(actions.canKeep).toBe(false);
  });

  it("canKeep is true when there is no deadline at all", () => {
    const actions = getVisibleActions({ displayStatus: "ordered", returnDeadline: null }, now);
    expect(actions.canKeep).toBe(true);
  });
});

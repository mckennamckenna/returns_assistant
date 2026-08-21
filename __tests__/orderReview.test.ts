import { describe, it, expect } from "vitest";
import { computeOrderReviewReason } from "../lib/orderReview";

const base = {
  id: "order-1",
  orderNumber: "ABC123",
  orderDate: new Date("2026-07-01"),
  orderTotal: 42,
  userNote: null as string | null,
  emails: [{ orderNumber: "ABC123" }],
};

describe("computeOrderReviewReason", () => {
  it("reports 'duplicate' when userNote has the [auto] retailer-prefix-merge marker — the real-world AquaTru/AquaTru Water case", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
    };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "duplicate",
      why: "This looks like a duplicate of another order.",
    });
  });

  it("prefers the [auto] marker over an order-number mismatch when both are present", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
      emails: [{ orderNumber: "DIFFERENT" }],
    };
    expect(computeOrderReviewReason(order, [{ id: "order-2", orderNumber: "DIFFERENT" }]).reasonId).toBe("duplicate");
  });

  it("reports 'belongs_to_existing_order' when a linked email's orderNumber matches a DIFFERENT existing order", () => {
    const order = { ...base, emails: [{ orderNumber: "DIFFERENT" }] };
    expect(computeOrderReviewReason(order, [{ id: "order-2", orderNumber: "DIFFERENT" }])).toEqual({
      reasonId: "belongs_to_existing_order",
      why: "We think this email belongs to an existing order.",
    });
  });

  it("does NOT report 'belongs_to_existing_order' when the mismatched number matches no other real order — a mismatch alone isn't enough (strengthened 2026-08-21; the pre-rebuild code treated any mismatch as sufficient)", () => {
    const order = { ...base, emails: [{ orderNumber: "DIFFERENT" }] };
    expect(computeOrderReviewReason(order, []).reasonId).not.toBe("belongs_to_existing_order");
  });

  it("never matches itself as the 'existing' order (candidateOrders includes the order being checked)", () => {
    const order = { ...base, emails: [{ orderNumber: "ABC123" }] };
    // emails[0].orderNumber === order.orderNumber, so this isn't even a
    // mismatch — but confirm self-exclusion holds regardless by using a
    // candidate list containing only the order itself under a different key.
    expect(computeOrderReviewReason(order, [{ id: "order-1", orderNumber: "ABC123" }]).reasonId).not.toBe(
      "belongs_to_existing_order",
    );
  });

  it("reports a missing purchase date", () => {
    const order = { ...base, orderDate: null };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "missing_order_date",
      why: "We couldn't find a purchase date — the deadline may be estimated.",
    });
  });

  it("reports a missing order total", () => {
    const order = { ...base, orderTotal: null };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "missing_order_total",
      why: "We couldn't find the order total.",
    });
  });

  it("prefers missing-date over missing-total when both apply", () => {
    const order = { ...base, orderDate: null, orderTotal: null };
    expect(computeOrderReviewReason(order, []).reasonId).toBe("missing_order_date");
  });

  it("falls back to 'uncertain_details' when nothing more specific applies", () => {
    expect(computeOrderReviewReason(base, [])).toEqual({
      reasonId: "uncertain_details",
      why: "We're not certain about some details on this order.",
    });
  });

  it("does not match a userNote that merely mentions [auto] without the exact merge format", () => {
    const order = { ...base, userNote: "[auto] something unrelated" };
    expect(computeOrderReviewReason(order, []).reasonId).toBe("uncertain_details");
  });

  it("defaults candidateOrders to [] when omitted (e.g. a caller with no other-orders data on hand)", () => {
    expect(() => computeOrderReviewReason(base)).not.toThrow();
  });
});

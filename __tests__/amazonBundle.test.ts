import { describe, it, expect } from "vitest";
import {
  isAmazonOrder,
  isDeliveredDecisionPending,
  amazonRowLabel,
  amazonComposition,
  earliestAmazonDeadline,
  compareNullableDate,
  type AmazonOrderLike,
} from "../lib/amazonBundle";

// ── isAmazonOrder ────────────────────────────────────────────────────────────
// AMAZON_HANDLING.md 2.4: strict, case-insensitive match — must fold in
// Amazon sub-brands (Fresh) but never adjacent retailers (Zappos, Whole
// Foods), which don't contain "amazon" in their retailer string.

describe("isAmazonOrder", () => {
  it("matches exact-case retailer string", () => {
    expect(isAmazonOrder("Amazon")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isAmazonOrder("AMAZON")).toBe(true);
    expect(isAmazonOrder("amazon")).toBe(true);
  });

  it("matches an Amazon sub-brand by substring", () => {
    expect(isAmazonOrder("Amazon Fresh")).toBe(true);
  });

  it("does NOT match adjacent, non-Amazon retailers", () => {
    expect(isAmazonOrder("Zappos")).toBe(false);
    expect(isAmazonOrder("Whole Foods")).toBe(false);
  });

  it("handles null retailer", () => {
    expect(isAmazonOrder(null)).toBe(false);
  });
});

// ── isDeliveredDecisionPending ───────────────────────────────────────────────
// O7 resolution: deliveredAt (not displayStatus) is what actually means
// "delivered." A manually-advanced return_requested/returned order is never
// "decision pending" even if deliveredAt happens to be set.

function order(overrides: Partial<AmazonOrderLike>): AmazonOrderLike {
  return {
    displayStatus: "shipped",
    deliveredAt: null,
    estimatedDeliveryDate: null,
    returnDeadline: null,
    ...overrides,
  };
}

describe("isDeliveredDecisionPending", () => {
  it("is true for a delivered order still in shipped/ordered displayStatus", () => {
    expect(isDeliveredDecisionPending(order({ deliveredAt: new Date(), displayStatus: "shipped" }))).toBe(true);
  });

  it("is false when not yet delivered", () => {
    expect(isDeliveredDecisionPending(order({ deliveredAt: null }))).toBe(false);
  });

  it("is false once return_requested, even if deliveredAt is set", () => {
    expect(isDeliveredDecisionPending(order({ deliveredAt: new Date(), displayStatus: "return_requested" }))).toBe(false);
  });

  it("is false once returned, even if deliveredAt is set", () => {
    expect(isDeliveredDecisionPending(order({ deliveredAt: new Date(), displayStatus: "returned" }))).toBe(false);
  });
});

// ── amazonRowLabel ───────────────────────────────────────────────────────────

describe("amazonRowLabel", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("shows days-left for a delivered, decision-pending order with a deadline", () => {
    const deadline = new Date("2026-07-27T12:00:00.000Z"); // 7 days out
    expect(amazonRowLabel(order({ deliveredAt: now, returnDeadline: deadline }), now)).toBe("7 days left");
  });

  it("shows Expired for a delivered order past its deadline", () => {
    const deadline = new Date("2026-07-10T12:00:00.000Z");
    expect(amazonRowLabel(order({ deliveredAt: now, returnDeadline: deadline }), now)).toBe("Expired");
  });

  it("shows Delivered when delivered but no deadline computed yet", () => {
    expect(amazonRowLabel(order({ deliveredAt: now, returnDeadline: null }), now)).toBe("Delivered");
  });

  it("shows an Arrives date when not yet delivered but an estimate exists", () => {
    const est = new Date("2026-07-29T00:00:00.000Z");
    expect(amazonRowLabel(order({ deliveredAt: null, estimatedDeliveryDate: est }), now)).toMatch(/^Arrives /);
  });

  it("prefers Return requested over a stale delivered/deadline reading", () => {
    const deadline = new Date("2026-07-27T12:00:00.000Z");
    expect(
      amazonRowLabel(order({ deliveredAt: now, returnDeadline: deadline, displayStatus: "return_requested" }), now),
    ).toBe("Return requested");
  });

  it("prefers Returned over a stale delivered/deadline reading", () => {
    expect(amazonRowLabel(order({ deliveredAt: now, displayStatus: "returned" }), now)).toBe("Returned");
  });

  it("falls back to the displayStatus label when nothing else is known", () => {
    expect(amazonRowLabel(order({ deliveredAt: null, estimatedDeliveryDate: null, displayStatus: "ordered" }), now)).toBe("Ordered");
  });
});

// ── amazonComposition ────────────────────────────────────────────────────────

describe("amazonComposition", () => {
  it("summarizes a mixed bundle in fixed bucket priority order", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const orders: AmazonOrderLike[] = [
      order({ deliveredAt: now }),
      order({ deliveredAt: now }),
      order({ deliveredAt: null, displayStatus: "shipped" }),
      order({ deliveredAt: null, displayStatus: "ordered" }),
    ];
    expect(amazonComposition(orders)).toBe("2 delivered · 1 in transit · 1 ordered");
  });

  it("omits empty buckets entirely", () => {
    const orders: AmazonOrderLike[] = [order({ deliveredAt: null, displayStatus: "ordered" })];
    expect(amazonComposition(orders)).toBe("1 ordered");
  });

  it("returns an empty string for an empty bundle", () => {
    expect(amazonComposition([])).toBe("");
  });
});

// ── earliestAmazonDeadline ───────────────────────────────────────────────────
// Only delivered, decision-pending children contribute a deadline —
// awaiting-refund/return_requested/not-yet-delivered are excluded (v1
// simplification, see lib/amazonBundle.ts).

describe("earliestAmazonDeadline", () => {
  it("picks the soonest deadline among delivered, decision-pending orders", () => {
    const soon = new Date("2026-07-22T00:00:00.000Z");
    const later = new Date("2026-07-30T00:00:00.000Z");
    const orders: AmazonOrderLike[] = [
      order({ deliveredAt: new Date(), returnDeadline: later }),
      order({ deliveredAt: new Date(), returnDeadline: soon }),
    ];
    expect(earliestAmazonDeadline(orders)).toBe(soon);
  });

  it("ignores not-yet-delivered orders even if they carry a returnDeadline", () => {
    const deadline = new Date("2026-07-22T00:00:00.000Z");
    const orders: AmazonOrderLike[] = [order({ deliveredAt: null, returnDeadline: deadline })];
    expect(earliestAmazonDeadline(orders)).toBeNull();
  });

  it("ignores awaiting-refund orders", () => {
    const deadline = new Date("2026-07-22T00:00:00.000Z");
    const orders: AmazonOrderLike[] = [order({ deliveredAt: new Date(), returnDeadline: deadline, displayStatus: "returned" })];
    expect(earliestAmazonDeadline(orders)).toBeNull();
  });

  it("returns null for an empty bundle", () => {
    expect(earliestAmazonDeadline([])).toBeNull();
  });
});

// ── compareNullableDate ──────────────────────────────────────────────────────

describe("compareNullableDate", () => {
  it("sorts nulls last regardless of surrounding values", () => {
    const d = new Date("2026-07-20T00:00:00.000Z");
    expect(compareNullableDate(null, d)).toBeGreaterThan(0);
    expect(compareNullableDate(d, null)).toBeLessThan(0);
    expect(compareNullableDate(null, null)).toBe(0);
  });

  it("sorts earlier dates first", () => {
    const earlier = new Date("2026-07-20T00:00:00.000Z");
    const later = new Date("2026-07-25T00:00:00.000Z");
    expect(compareNullableDate(earlier, later)).toBeLessThan(0);
  });
});

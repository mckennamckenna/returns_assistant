import { describe, it, expect } from "vitest";
import { computeDeadline, routeDeliveryDate, resolveEstimatedDeliveryDate } from "../lib/extract";

describe("routeDeliveryDate", () => {
  it("routes a delivery email's date to deliveredAt", () => {
    expect(routeDeliveryDate("delivery", "2026-07-07")).toEqual({
      estimatedDeliveryDate: null,
      deliveredAt: "2026-07-07",
    });
  });

  it("routes a shipping_confirmation email's date to estimatedDeliveryDate", () => {
    expect(routeDeliveryDate("shipping_confirmation", "2026-07-07")).toEqual({
      estimatedDeliveryDate: "2026-07-07",
      deliveredAt: null,
    });
  });

  it("routes an order_confirmation email's stray date to estimatedDeliveryDate too", () => {
    expect(routeDeliveryDate("order_confirmation", "2026-07-07")).toEqual({
      estimatedDeliveryDate: "2026-07-07",
      deliveredAt: null,
    });
  });

  it("returns nulls when there's no date to route", () => {
    expect(routeDeliveryDate("delivery", null)).toEqual({ estimatedDeliveryDate: null, deliveredAt: null });
  });
});

describe("resolveEstimatedDeliveryDate", () => {
  it("prefers a real routed estimate (shipping_confirmation/delivery) over a preorder shipByDate", () => {
    expect(resolveEstimatedDeliveryDate("2026-07-07", "2026-08-19")).toBe("2026-07-07");
  });

  it("falls back to shipByDate when this email had no delivery signal of its own", () => {
    expect(resolveEstimatedDeliveryDate(null, "2026-08-19")).toBe("2026-08-19");
  });

  it("returns null when neither is present — no behavior change for a normal order", () => {
    expect(resolveEstimatedDeliveryDate(null, null)).toBeNull();
  });
});

describe("computeDeadline", () => {
  const base = {
    orderDate: "2026-06-01T00:00:00.000Z",
    deliveredAt: null as string | null,
    estimatedDeliveryDate: null as string | null,
    returnWindowDays: 30,
    returnWindowStartsFrom: "delivery_date" as "order_date" | "delivery_date" | null,
  };

  it("confirmed (not estimated) when deliveredAt is present — the real bug fix", () => {
    const result = computeDeadline({ ...base, deliveredAt: "2026-06-10T00:00:00.000Z" });
    expect(result.deadlineIsEstimated).toBe(false);
    expect(result.returnDeadline).toBe(new Date("2026-07-10T00:00:00.000Z").toISOString());
  });

  it("estimated when only estimatedDeliveryDate is present (carrier ETA, no confirmed delivery) — the Proenza Schouler case", () => {
    const result = computeDeadline({ ...base, estimatedDeliveryDate: "2026-06-10T00:00:00.000Z" });
    expect(result.deadlineIsEstimated).toBe(true);
    expect(result.returnDeadline).toBe(new Date("2026-07-10T00:00:00.000Z").toISOString());
  });

  it("deliveredAt wins over estimatedDeliveryDate when both are present", () => {
    const result = computeDeadline({
      ...base,
      deliveredAt: "2026-06-10T00:00:00.000Z",
      estimatedDeliveryDate: "2026-06-05T00:00:00.000Z",
    });
    expect(result.deadlineIsEstimated).toBe(false);
    expect(result.returnDeadline).toBe(new Date("2026-07-10T00:00:00.000Z").toISOString());
  });

  it("order_date-anchored policy (Amazon) ignores delivery info entirely, even when estimatedDeliveryDate is present", () => {
    const result = computeDeadline({
      ...base,
      returnWindowStartsFrom: "order_date",
      estimatedDeliveryDate: "2026-06-20T00:00:00.000Z",
    });
    expect(result.deadlineIsEstimated).toBe(false);
    expect(result.returnDeadline).toBe(new Date("2026-07-01T00:00:00.000Z").toISOString());
  });

  it("order_date-anchored policy ignores deliveredAt too", () => {
    const result = computeDeadline({
      ...base,
      returnWindowStartsFrom: "order_date",
      deliveredAt: "2026-06-20T00:00:00.000Z",
    });
    expect(result.deadlineIsEstimated).toBe(false);
    expect(result.returnDeadline).toBe(new Date("2026-07-01T00:00:00.000Z").toISOString());
  });

  it("falls back to orderDate + standard shipping buffer (tightened 7→5 days, 2026-07-15), estimated, when the policy is explicitly delivery_date-anchored with no delivery signal at all", () => {
    const result = computeDeadline({ ...base });
    expect(result.deadlineIsEstimated).toBe(true);
    // orderDate + 5 (STANDARD_SHIPPING_DAYS, tightened from 7) + 30 (returnWindowDays)
    expect(result.returnDeadline).toBe(new Date("2026-07-06T00:00:00.000Z").toISOString());
  });

  it("order_date-anchored policy with no delivery signal at all is not estimated", () => {
    const result = computeDeadline({ ...base, returnWindowStartsFrom: "order_date" });
    expect(result.deadlineIsEstimated).toBe(false);
    expect(result.returnDeadline).toBe(new Date("2026-07-01T00:00:00.000Z").toISOString());
  });

  it("returns null when returnWindowDays is missing", () => {
    const result = computeDeadline({ ...base, returnWindowDays: null });
    expect(result).toEqual({ returnDeadline: null, deadlineIsEstimated: false });
  });

  it("returns null when there's no orderDate and no delivery signal", () => {
    const result = computeDeadline({ ...base, orderDate: null });
    expect(result).toEqual({ returnDeadline: null, deadlineIsEstimated: false });
  });

  describe("null/unknown returnWindowStartsFrom (Decision 1, 2026-07-15)", () => {
    it("Sidekick's real inputs: anchors on orderDate directly, ignoring the absence of any delivery signal, no buffer applied", () => {
      const result = computeDeadline({
        orderDate: "2026-06-25T20:33:00.000Z",
        deliveredAt: null,
        estimatedDeliveryDate: null,
        returnWindowDays: 60,
        returnWindowStartsFrom: null,
      });
      expect(result.returnDeadline).toBe(new Date("2026-08-24T20:33:00.000Z").toISOString());
      expect(result.deadlineIsEstimated).toBe(true);
    });

    it("still anchors on orderDate, ignoring a known real delivery signal — the conservative default applies even when delivery data exists, since the true anchor is unconfirmed", () => {
      const result = computeDeadline({
        ...base,
        returnWindowStartsFrom: null,
        deliveredAt: "2026-06-20T00:00:00.000Z",
      });
      expect(result.returnDeadline).toBe(new Date("2026-07-01T00:00:00.000Z").toISOString());
      expect(result.deadlineIsEstimated).toBe(true);
    });

    it("falls back to a known delivery signal when there's no orderDate to anchor on at all", () => {
      const result = computeDeadline({
        ...base,
        orderDate: null,
        returnWindowStartsFrom: null,
        deliveredAt: "2026-06-10T00:00:00.000Z",
      });
      expect(result.returnDeadline).toBe(new Date("2026-07-10T00:00:00.000Z").toISOString());
      expect(result.deadlineIsEstimated).toBe(false);
    });

    it("returns null when there's no orderDate and no delivery signal at all", () => {
      const result = computeDeadline({ ...base, orderDate: null, returnWindowStartsFrom: null });
      expect(result).toEqual({ returnDeadline: null, deadlineIsEstimated: false });
    });
  });

  describe("preorder ship-date handling (Loeffler Randall #512867 case)", () => {
    // Real reported inputs: orderDate 6/29, returnWindowStartsFrom
    // "delivery_date" (stated in-email), returnWindowDays 21, no delivery
    // signal at all — this is exactly what produced the wrong "Jul 25"
    // deadline (6/29 + 5-day fallback + 21 days), about a month before the
    // item's real 8/19 ship-by date.
    const lrBase = {
      orderDate: "2026-06-29T00:00:00.000Z",
      deliveredAt: null as string | null,
      estimatedDeliveryDate: null as string | null,
      returnWindowDays: 21,
      returnWindowStartsFrom: "delivery_date" as "order_date" | "delivery_date" | null,
    };

    it("reproduces the original bug: falls back to the 5-day buffer with no ship-date awareness", () => {
      const result = computeDeadline(lrBase);
      expect(result.deadlineIsEstimated).toBe(true);
      // 6/29 + 5 + 21 = 7/25 — the actual wrong deadline observed in production.
      expect(result.returnDeadline).toBe(new Date("2026-07-25T00:00:00.000Z").toISOString());
    });

    it("anchors on a preorder's shipByDate (routed into estimatedDeliveryDate) instead, once known", () => {
      const result = computeDeadline({ ...lrBase, estimatedDeliveryDate: "2026-08-19T00:00:00.000Z" });
      expect(result.deadlineIsEstimated).toBe(true);
      // 8/19 + 21 = 9/9 — sane, and no longer before the item even ships.
      expect(result.returnDeadline).toBe(new Date("2026-09-09T00:00:00.000Z").toISOString());
      expect(new Date(result.returnDeadline!).getTime()).toBeGreaterThan(new Date(lrBase.orderDate).getTime() + 5 * 24 * 60 * 60 * 1000 + 21 * 24 * 60 * 60 * 1000);
    });
  });
});

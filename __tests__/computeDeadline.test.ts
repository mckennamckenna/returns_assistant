import { describe, it, expect } from "vitest";
import { computeDeadline, routeDeliveryDate } from "../lib/extract";

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
});

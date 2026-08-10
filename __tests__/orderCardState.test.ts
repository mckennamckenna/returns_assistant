import { describe, it, expect } from "vitest";
import {
  computeOrderCardState,
  orderCardChip,
  orderCardActions,
  isMultiItemOrder,
  REFUND_AMOUNT_FOOTNOTE,
} from "../lib/orderCardState";

const now = new Date("2026-08-10T12:00:00Z");
const future = new Date("2026-08-20T00:00:00Z");
const past = new Date("2026-07-01T00:00:00Z");

describe("computeOrderCardState", () => {
  it("not yet delivered -> awaiting_delivery", () => {
    expect(computeOrderCardState({ deliveredAt: null, displayStatus: "shipped" })).toBe("awaiting_delivery");
    expect(computeOrderCardState({ deliveredAt: null, displayStatus: "ordered" })).toBe("awaiting_delivery");
  });

  it("delivered, no decision -> returnable, keyed off deliveredAt not displayStatus (O7)", () => {
    // displayStatus still reads "shipped" here — the AquaTru "Shipped
    // forever" shape — but deliveredAt is what decides the state.
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "shipped" })).toBe("returnable");
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "delivered" })).toBe("returnable");
  });

  it("return_requested -> return_started", () => {
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "return_requested" })).toBe("return_started");
  });

  it("returned -> awaiting_refund", () => {
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "returned" })).toBe("awaiting_refund");
  });

  it("refunded -> complete", () => {
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "refunded" })).toBe("complete");
  });

  it("kept -> kept, regardless of deliveredAt", () => {
    expect(computeOrderCardState({ deliveredAt: null, displayStatus: "kept" })).toBe("kept");
    expect(computeOrderCardState({ deliveredAt: past, displayStatus: "kept" })).toBe("kept");
  });

  // The previously-logged bug (CARD_SPEC.md Part 2, Q8): unarchiving a Kept
  // or Refunded order must show the terminal chip, never a recomputed live
  // countdown. This holds by construction here because displayStatus is
  // checked before deliveredAt/returnDeadline are ever consulted — archivedAt
  // isn't even an input to this function, so unarchiving can't change the
  // computed state.
  it("unarchive-a-Kept-order: state and chip stay terminal, no countdown, independent of archivedAt", () => {
    const keptOrder = { deliveredAt: past, displayStatus: "kept" };
    const state = computeOrderCardState(keptOrder);
    expect(state).toBe("kept");

    const chip = orderCardChip({
      state,
      displayStatus: "kept",
      estimatedDeliveryDate: null,
      returnDeadline: past, // deadline long expired — must not leak into the chip
      orderTotal: 200,
      lineItems: null,
      now,
    });
    expect(chip).toEqual({ label: "Kept", tone: "kept" });
    expect(orderCardActions(state)).toEqual([]);
  });

  it("unarchive-a-Refunded-order: same guarantee", () => {
    const state = computeOrderCardState({ deliveredAt: past, displayStatus: "refunded" });
    expect(state).toBe("complete");
    const chip = orderCardChip({
      state,
      displayStatus: "refunded",
      estimatedDeliveryDate: null,
      returnDeadline: past,
      orderTotal: 200,
      lineItems: null,
      now,
    });
    expect(chip).toEqual({ label: "Refunded", tone: "refunded" });
    expect(orderCardActions(state)).toEqual([]);
  });
});

describe("orderCardChip", () => {
  it("awaiting_delivery with an estimated delivery date", () => {
    const chip = orderCardChip({
      state: "awaiting_delivery",
      displayStatus: "shipped",
      estimatedDeliveryDate: new Date("2026-08-15T00:00:00Z"),
      returnDeadline: null,
      orderTotal: null,
      lineItems: null,
      now,
    });
    expect(chip.label).toBe("Arrives Aug 15");
    expect(chip.tone).toBe("neutral");
  });

  it("awaiting_delivery with no estimate falls back to the displayStatus label", () => {
    const chip = orderCardChip({
      state: "awaiting_delivery",
      displayStatus: "ordered",
      estimatedDeliveryDate: null,
      returnDeadline: null,
      orderTotal: null,
      lineItems: null,
      now,
    });
    expect(chip.label).toBe("Ordered");
  });

  it("returnable: urgent/warning/safe tone thresholds match the existing DaysLeftChip cutoffs", () => {
    const chipFor = (deadline: Date) =>
      orderCardChip({
        state: "returnable",
        displayStatus: "delivered",
        estimatedDeliveryDate: null,
        returnDeadline: deadline,
        orderTotal: null,
        lineItems: null,
        now,
      });

    expect(chipFor(new Date("2026-08-11T00:00:00Z"))).toMatchObject({ tone: "urgent" });
    expect(chipFor(new Date("2026-08-16T00:00:00Z"))).toMatchObject({ tone: "warning" });
    expect(chipFor(new Date("2026-08-25T00:00:00Z"))).toMatchObject({ tone: "safe" });
  });

  it("returnable past its deadline reads Expired, not a negative day count", () => {
    const chip = orderCardChip({
      state: "returnable",
      displayStatus: "delivered",
      estimatedDeliveryDate: null,
      returnDeadline: past,
      orderTotal: null,
      lineItems: null,
      now,
    });
    expect(chip.label).toBe("Expired");
  });

  it("return_started: fixed 'Return requested' chip", () => {
    const chip = orderCardChip({
      state: "return_started",
      displayStatus: "return_requested",
      estimatedDeliveryDate: null,
      returnDeadline: future,
      orderTotal: null,
      lineItems: null,
      now,
    });
    expect(chip.label).toBe("Return requested");
  });

  it("awaiting_refund with no known total: no amount rendered", () => {
    const chip = orderCardChip({
      state: "awaiting_refund",
      displayStatus: "returned",
      estimatedDeliveryDate: null,
      returnDeadline: null,
      orderTotal: null,
      lineItems: null,
      now,
    });
    expect(chip.label).toBe("Refund pending");
    expect(chip.amount).toBeUndefined();
  });

  it("awaiting_refund, single-item order: amount shown without the asterisk", () => {
    const chip = orderCardChip({
      state: "awaiting_refund",
      displayStatus: "returned",
      estimatedDeliveryDate: null,
      returnDeadline: null,
      orderTotal: 200,
      lineItems: [{ name: "Jacket", price: 200, quantity: 1 }],
      now,
    });
    expect(chip.amount).toEqual({ total: 200, asterisked: false });
  });

  it("awaiting_refund, multi-item order: amount MUST be asterisked (Part 5 Q5)", () => {
    const chip = orderCardChip({
      state: "awaiting_refund",
      displayStatus: "returned",
      estimatedDeliveryDate: null,
      returnDeadline: null,
      orderTotal: 200,
      lineItems: [
        { name: "Jacket", price: 150, quantity: 1 },
        { name: "Scarf", price: 50, quantity: 1 },
      ],
      now,
    });
    expect(chip.amount).toEqual({ total: 200, asterisked: true });
  });
});

describe("isMultiItemOrder", () => {
  it("false for null, empty, and single-item line item arrays", () => {
    expect(isMultiItemOrder(null)).toBe(false);
    expect(isMultiItemOrder([])).toBe(false);
    expect(isMultiItemOrder([{ name: "Jacket", price: 200, quantity: 1 }])).toBe(false);
  });

  it("true for two or more items", () => {
    expect(
      isMultiItemOrder([
        { name: "Jacket", price: 150, quantity: 1 },
        { name: "Scarf", price: 50, quantity: 1 },
      ]),
    ).toBe(true);
  });
});

describe("orderCardActions", () => {
  it("awaiting_delivery: Keep only", () => {
    expect(orderCardActions("awaiting_delivery")).toEqual([{ id: "keep", label: "Keep" }]);
  });

  it("returnable: Keep and Start Return as two distinct entries (mobile audit #4)", () => {
    expect(orderCardActions("returnable")).toEqual([
      { id: "keep", label: "Keep" },
      { id: "start_return", label: "Start Return" },
    ]);
  });

  it("return_started: Dropped it off? only", () => {
    expect(orderCardActions("return_started")).toEqual([{ id: "mark_returned", label: "Dropped it off?" }]);
  });

  it("awaiting_refund: Refund received? only", () => {
    expect(orderCardActions("awaiting_refund")).toEqual([{ id: "mark_refunded", label: "Refund received?" }]);
  });

  it("terminal states have no actions", () => {
    expect(orderCardActions("kept")).toEqual([]);
    expect(orderCardActions("complete")).toEqual([]);
  });
});

it("REFUND_AMOUNT_FOOTNOTE is non-empty (mandatory gloss, Part 5 Q5)", () => {
  expect(REFUND_AMOUNT_FOOTNOTE.length).toBeGreaterThan(0);
});

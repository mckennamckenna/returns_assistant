import { describe, it, expect, vi } from "vitest";
import {
  shouldShowCreateNewEscapeHatch,
  createNewOrderEscapeHatchLabel,
  runCreateNewOrderEscapeHatch,
} from "../lib/shipmentUnlinkedPicker";
import type { NeedsReviewReasonId } from "../lib/needsReviewReasons";

describe("shouldShowCreateNewEscapeHatch", () => {
  it("is true for shipment_unlinked", () => {
    expect(shouldShowCreateNewEscapeHatch("shipment_unlinked")).toBe(true);
  });

  it("is false for every other reasonId — a real match/return-side signal means there's a right order to pick, not a dead end to escape", () => {
    const others: NeedsReviewReasonId[] = [
      "belongs_to_existing_order",
      "duplicate",
      "return_or_refund_no_link",
      "real_purchase_no_record",
      "no_extraction_signal",
      "missing_order_date",
      "missing_order_total",
      "uncertain_details",
    ];
    for (const reasonId of others) {
      expect(shouldShowCreateNewEscapeHatch(reasonId)).toBe(false);
    }
  });
});

describe("createNewOrderEscapeHatchLabel", () => {
  it("includes the retailer name when known", () => {
    expect(createNewOrderEscapeHatchLabel("H&M")).toBe("+ Start a new order for H&M");
  });

  it("a second retailer (Poshmark) — proves the label isn't H&M-specific", () => {
    expect(createNewOrderEscapeHatchLabel("Poshmark")).toBe("+ Start a new order for Poshmark");
  });

  it("falls back to a retailer-less label when retailer is null", () => {
    expect(createNewOrderEscapeHatchLabel(null)).toBe("+ Start a new order");
  });
});

describe("runCreateNewOrderEscapeHatch", () => {
  it("populated-list case: confirmed — calls createFn with the emailId and returns true", async () => {
    const createFn = vi.fn().mockResolvedValue(undefined);
    const confirmFn = vi.fn().mockReturnValue(true);

    const result = await runCreateNewOrderEscapeHatch("email-1", confirmFn, createFn);

    expect(result).toBe(true);
    expect(createFn).toHaveBeenCalledWith("email-1");
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it("empty-list case: confirmed — behaves identically whether or not real candidates exist, since the function has no awareness of the list itself", async () => {
    const createFn = vi.fn().mockResolvedValue(undefined);
    const confirmFn = vi.fn().mockReturnValue(true);

    const result = await runCreateNewOrderEscapeHatch("email-2", confirmFn, createFn);

    expect(result).toBe(true);
    expect(createFn).toHaveBeenCalledWith("email-2");
  });

  it("declined confirm — does not call createFn, returns false", async () => {
    const createFn = vi.fn().mockResolvedValue(undefined);
    const confirmFn = vi.fn().mockReturnValue(false);

    const result = await runCreateNewOrderEscapeHatch("email-3", confirmFn, createFn);

    expect(result).toBe(false);
    expect(createFn).not.toHaveBeenCalled();
  });
});

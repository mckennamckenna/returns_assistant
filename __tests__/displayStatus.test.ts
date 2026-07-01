import { describe, it, expect } from "vitest";
import { deriveDisplayStatus, DISPLAY_STATUS_RANK } from "../lib/displayStatus";

describe("deriveDisplayStatus", () => {
  // ── Basic derivation ──────────────────────────────────────────────────────
  it("returns 'ordered' when no shipping_confirmation, delivery, or return_label is present", () => {
    expect(deriveDisplayStatus(["order_confirmation"], "ordered")).toBe("ordered");
  });

  it("advances to 'shipped' when shipping_confirmation is present", () => {
    expect(deriveDisplayStatus(["order_confirmation", "shipping_confirmation"], "ordered")).toBe("shipped");
  });

  it("advances to 'shipped' when only delivery is present (delivery implies shipped)", () => {
    expect(deriveDisplayStatus(["delivery"], "ordered")).toBe("shipped");
  });

  it("advances to 'shipped' when delivery and order_confirmation are present but no shipping_confirmation", () => {
    expect(deriveDisplayStatus(["order_confirmation", "delivery"], "ordered")).toBe("shipped");
  });

  it("advances to 'shipped' when both shipping_confirmation and delivery are present", () => {
    expect(deriveDisplayStatus(["order_confirmation", "shipping_confirmation", "delivery"], "ordered")).toBe("shipped");
  });

  it("advances to 'return_requested' when return_label is present", () => {
    expect(deriveDisplayStatus(["order_confirmation", "return_label"], "ordered")).toBe("return_requested");
  });

  it("advances to 'return_requested' when return_label is present alongside shipping and delivery", () => {
    expect(deriveDisplayStatus(["order_confirmation", "shipping_confirmation", "delivery", "return_label"], "shipped")).toBe("return_requested");
  });

  it("returns 'ordered' for an empty email list", () => {
    expect(deriveDisplayStatus([], "ordered")).toBe("ordered");
  });

  // ── Never-downgrade rule ──────────────────────────────────────────────────
  it("does not downgrade return_requested to shipped when shipping_confirmation is present", () => {
    expect(deriveDisplayStatus(["shipping_confirmation"], "return_requested")).toBe("return_requested");
  });

  it("does not downgrade return_requested to ordered", () => {
    expect(deriveDisplayStatus([], "return_requested")).toBe("return_requested");
  });

  it("does not downgrade return_requested even when return_label is present (already at that rank)", () => {
    expect(deriveDisplayStatus(["return_label"], "return_requested")).toBe("return_requested");
  });

  it("does not downgrade returned", () => {
    expect(deriveDisplayStatus(["shipping_confirmation", "return_label"], "returned")).toBe("returned");
  });

  it("does not downgrade refunded", () => {
    expect(deriveDisplayStatus(["shipping_confirmation", "return_label"], "refunded")).toBe("refunded");
  });

  it("does not downgrade shipped to ordered", () => {
    // Once shipped, adding no new email types (e.g. on recompute) must not move it back.
    expect(deriveDisplayStatus([], "shipped")).toBe("shipped");
  });

  // ── Idempotent on re-run ──────────────────────────────────────────────────
  it("is idempotent: re-running with shipping_confirmation when already shipped stays shipped", () => {
    expect(deriveDisplayStatus(["shipping_confirmation"], "shipped")).toBe("shipped");
  });

  it("is idempotent: re-running with return_label when already return_requested stays return_requested", () => {
    expect(deriveDisplayStatus(["return_label"], "return_requested")).toBe("return_requested");
  });
});

describe("DISPLAY_STATUS_RANK", () => {
  it("has strictly increasing ranks: ordered < shipped < return_requested < returned < refunded", () => {
    expect(DISPLAY_STATUS_RANK.ordered).toBeLessThan(DISPLAY_STATUS_RANK.shipped);
    expect(DISPLAY_STATUS_RANK.shipped).toBeLessThan(DISPLAY_STATUS_RANK.return_requested);
    expect(DISPLAY_STATUS_RANK.return_requested).toBeLessThan(DISPLAY_STATUS_RANK.returned);
    expect(DISPLAY_STATUS_RANK.returned).toBeLessThan(DISPLAY_STATUS_RANK.refunded);
  });
});

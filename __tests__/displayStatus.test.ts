import { describe, it, expect } from "vitest";
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_RANK,
  buildStatusTransitionData,
  requiresConfirmBeforeStatusChange,
} from "../lib/displayStatus";

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

// ── buildStatusTransitionData: the refunded-misclick fix ────────────────────
// Refunded auto-archives in the same write as the status change — both
// fields must come from a single object passed to one prisma.order.update()
// call, so the two writes are atomic by construction (not a follow-up write
// from a hook/subscriber/cron).

describe("buildStatusTransitionData", () => {
  it("sets both displayStatus and a fresh archivedAt when transitioning to refunded (not yet archived)", () => {
    const data = buildStatusTransitionData("refunded", { returnedAt: new Date("2026-06-30T00:00:00Z"), archivedAt: null });
    expect(data.displayStatus).toBe("refunded");
    expect(data.archivedAt).toBeInstanceOf(Date);
  });

  it("does NOT overwrite an existing archivedAt when the order was already archived before refunding", () => {
    const existingArchivedAt = new Date("2026-06-20T00:00:00Z");
    const data = buildStatusTransitionData("refunded", { returnedAt: new Date("2026-06-30T00:00:00Z"), archivedAt: existingArchivedAt });
    expect(data.displayStatus).toBe("refunded");
    expect(data.archivedAt).toBeUndefined(); // omitted entirely — update() won't touch the column
  });

  it("does not set archivedAt when transitioning to returned (only refunded auto-archives)", () => {
    const data = buildStatusTransitionData("returned", { returnedAt: null, archivedAt: null });
    expect(data.displayStatus).toBe("returned");
    expect(data.archivedAt).toBeUndefined();
  });

  it("sets returnedAt once on first arrival at returned (existing behavior, unchanged)", () => {
    const data = buildStatusTransitionData("returned", { returnedAt: null, archivedAt: null });
    expect(data.returnedAt).toBeInstanceOf(Date);
  });

  it("does not reset returnedAt if already set", () => {
    const existingReturnedAt = new Date("2026-06-25T00:00:00Z");
    const data = buildStatusTransitionData("returned", { returnedAt: existingReturnedAt, archivedAt: null });
    expect(data.returnedAt).toBeUndefined();
  });
});

// ── requiresConfirmBeforeStatusChange: the confirm-dialog gate ──────────────
// "Mark as refunded" needs a confirm (irreversible in the UI, auto-archives).
// "Mark as returned" / "Mark as return-requested" must NOT — this is the
// regression guard for the misclick fix: only refunded should ever gate.

describe("requiresConfirmBeforeStatusChange", () => {
  it("requires confirmation before transitioning to refunded", () => {
    expect(requiresConfirmBeforeStatusChange("refunded")).toBe(true);
  });

  it("does NOT require confirmation before transitioning to returned (regression guard)", () => {
    expect(requiresConfirmBeforeStatusChange("returned")).toBe(false);
  });

  it("does NOT require confirmation before transitioning to return_requested", () => {
    expect(requiresConfirmBeforeStatusChange("return_requested")).toBe(false);
  });
});

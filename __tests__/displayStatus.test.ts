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

// ── Refund branching (Bugs 9+10+11) ─────────────────────────────────────────
// Retailer refund emails are frequently vague ("we're processing your
// refund") without confirming the money actually moved — that's exactly what
// the product exists to catch. A refund email with a confirmed amount
// advances to "refunded" (chapter closed); without one, it advances only to
// "returned" so the existing refund check-in reminder can nudge the user
// later to verify. This is the one auto-derivation signal allowed to move
// an order past return_requested/returned on its own.

describe("deriveDisplayStatus — refund branching", () => {
  it("advances to 'refunded' when a refund email has a confirmed amount (Lola Blankets / Shopbop shape)", () => {
    expect(deriveDisplayStatus(["refund"], "ordered", true)).toBe("refunded");
  });

  it("advances only to 'returned' when a refund email has no confirmed amount (H&M shape)", () => {
    expect(deriveDisplayStatus(["refund"], "ordered", false)).toBe("returned");
  });

  it("defaults hasConfirmedRefundAmount to false when the argument is omitted", () => {
    expect(deriveDisplayStatus(["refund"], "ordered")).toBe("returned");
  });

  it("a confirmed-amount refund can advance an order already at return_requested straight to refunded", () => {
    expect(deriveDisplayStatus(["refund"], "return_requested", true)).toBe("refunded");
  });

  it("a no-amount refund can still advance an order already at return_requested to returned", () => {
    expect(deriveDisplayStatus(["refund"], "return_requested", false)).toBe("returned");
  });

  it("does not downgrade an already-refunded order when a later refund email has no confirmed amount", () => {
    // The H&M real-world case: order was already manually corrected to
    // "refunded"; a since-linked vague refund email must not undo that.
    expect(deriveDisplayStatus(["refund"], "refunded", false)).toBe("refunded");
  });

  it("does not downgrade an already-returned order when a refund email has no confirmed amount", () => {
    expect(deriveDisplayStatus(["refund"], "returned", false)).toBe("returned");
  });

  it("a confirmed-amount refund still advances an already-returned order to refunded", () => {
    expect(deriveDisplayStatus(["refund"], "returned", true)).toBe("refunded");
  });

  it("a refund email is evaluated even when other signals (return_label) are also present", () => {
    expect(deriveDisplayStatus(["return_label", "refund"], "shipped", true)).toBe("refunded");
  });
});

// ── "kept" guard ─────────────────────────────────────────────────────────
// kept is manual-only and never auto-derived. Its rank ties with "returned",
// which means the refund branch above — the one auto-derivation signal
// exempt from normal downgrade protection — would otherwise treat
// refunded(5) > kept(4) as a valid advance and silently overwrite a manual
// kept decision. This is the regression guard for that.

describe("deriveDisplayStatus — kept guard", () => {
  it("stays 'kept' regardless of email types, including a confirmed-amount refund", () => {
    expect(deriveDisplayStatus(["refund"], "kept", true)).toBe("kept");
  });

  it("stays 'kept' when a return_label email arrives", () => {
    expect(deriveDisplayStatus(["return_label"], "kept")).toBe("kept");
  });

  it("stays 'kept' for an empty email list", () => {
    expect(deriveDisplayStatus([], "kept")).toBe("kept");
  });

  it("never derives 'kept' from any email signal — only reachable manually", () => {
    expect(deriveDisplayStatus(["return_label", "shipping_confirmation", "delivery"], "ordered")).not.toBe("kept");
  });
});

describe("DISPLAY_STATUS_RANK", () => {
  it("has strictly increasing ranks: ordered < shipped < return_requested < returned < refunded", () => {
    expect(DISPLAY_STATUS_RANK.ordered).toBeLessThan(DISPLAY_STATUS_RANK.shipped);
    expect(DISPLAY_STATUS_RANK.shipped).toBeLessThan(DISPLAY_STATUS_RANK.return_requested);
    expect(DISPLAY_STATUS_RANK.return_requested).toBeLessThan(DISPLAY_STATUS_RANK.returned);
    expect(DISPLAY_STATUS_RANK.returned).toBeLessThan(DISPLAY_STATUS_RANK.refunded);
  });

  // "kept" is deliberately tied with "returned" (not ranked above "refunded")
  // — this is what makes both PATCH /api/orders/:id/status and
  // advanceDisplayStatus() enforce "reachable from ordered/shipped/
  // return_requested, not from returned/refunded" via their existing
  // generic rank-gate, with no bespoke branching for kept in either.
  it("ties 'kept' with 'returned', ranked below 'refunded'", () => {
    expect(DISPLAY_STATUS_RANK.kept).toBe(DISPLAY_STATUS_RANK.returned);
    expect(DISPLAY_STATUS_RANK.kept).toBeLessThan(DISPLAY_STATUS_RANK.refunded);
  });

  it("kept is reachable (higher rank) from ordered, shipped, and return_requested", () => {
    expect(DISPLAY_STATUS_RANK.kept).toBeGreaterThan(DISPLAY_STATUS_RANK.ordered);
    expect(DISPLAY_STATUS_RANK.kept).toBeGreaterThan(DISPLAY_STATUS_RANK.shipped);
    expect(DISPLAY_STATUS_RANK.kept).toBeGreaterThan(DISPLAY_STATUS_RANK.return_requested);
  });

  it("kept is NOT reachable (not higher rank) from returned or refunded", () => {
    expect(DISPLAY_STATUS_RANK.kept).not.toBeGreaterThan(DISPLAY_STATUS_RANK.returned);
    expect(DISPLAY_STATUS_RANK.kept).not.toBeGreaterThan(DISPLAY_STATUS_RANK.refunded);
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

  // ── Auto-derived refund jumping straight to "refunded" (Bugs 9+10+11) ──────
  // Manual "Mark as refunded" is always gated behind an existing "returned"
  // status, so returnedAt is already set by the time it calls this. But a
  // confirmed-amount refund email can auto-derive straight from an earlier
  // status to "refunded" without ever passing through "returned" — without
  // this backfill, returnedAt would stay null forever for those orders.
  it("backfills returnedAt when transitioning straight to refunded with no prior returnedAt", () => {
    const data = buildStatusTransitionData("refunded", { returnedAt: null, archivedAt: null });
    expect(data.returnedAt).toBeInstanceOf(Date);
  });

  it("does not overwrite returnedAt when transitioning to refunded if already set", () => {
    const existingReturnedAt = new Date("2026-06-25T00:00:00Z");
    const data = buildStatusTransitionData("refunded", { returnedAt: existingReturnedAt, archivedAt: null });
    expect(data.returnedAt).toBeUndefined();
  });

  // ── "kept" transition ────────────────────────────────────────────────────
  // Same auto-archive shape as refunded, plus its own keptAt timestamp.
  // Deliberately does NOT touch returnedAt — kept is a distinct terminal
  // branch, not a stand-in for having actually returned the item.
  it("sets displayStatus, archivedAt, and keptAt when transitioning to kept (not yet archived)", () => {
    const data = buildStatusTransitionData("kept", { returnedAt: null, archivedAt: null, keptAt: null });
    expect(data.displayStatus).toBe("kept");
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(data.keptAt).toBeInstanceOf(Date);
    expect(data.returnedAt).toBeUndefined();
  });

  it("does NOT overwrite an existing archivedAt when transitioning to kept if already archived", () => {
    const existingArchivedAt = new Date("2026-06-20T00:00:00Z");
    const data = buildStatusTransitionData("kept", { returnedAt: null, archivedAt: existingArchivedAt, keptAt: null });
    expect(data.archivedAt).toBeUndefined();
  });

  it("does not reset keptAt if already set", () => {
    const existingKeptAt = new Date("2026-06-25T00:00:00Z");
    const data = buildStatusTransitionData("kept", { returnedAt: null, archivedAt: new Date(), keptAt: existingKeptAt });
    expect(data.keptAt).toBeUndefined();
  });

  it("treats a missing keptAt field the same as null (optional for backward compatibility)", () => {
    const data = buildStatusTransitionData("kept", { returnedAt: null, archivedAt: null });
    expect(data.keptAt).toBeInstanceOf(Date);
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

  it("does NOT require confirmation before transitioning to kept (inline caption instead, no dollar amount at stake)", () => {
    expect(requiresConfirmBeforeStatusChange("kept")).toBe(false);
  });
});

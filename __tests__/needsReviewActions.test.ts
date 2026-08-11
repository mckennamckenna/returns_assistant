import { describe, it, expect } from "vitest";
import { needsReviewAction, NEEDS_REVIEW_ACTION_LABELS } from "../lib/needsReviewActions";

describe("needsReviewAction", () => {
  it("an already-linked order degrades to view_detail (Q9 fallback — no merge-two-orders flow exists)", () => {
    expect(needsReviewAction({ kind: "order", hasRetailer: true })).toEqual({
      id: "view_detail",
      label: "More info",
    });
    expect(needsReviewAction({ kind: "order", hasRetailer: false })).toEqual({
      id: "view_detail",
      label: "More info",
    });
  });

  it("an orphaned email with a retailer offers create_new_order", () => {
    expect(needsReviewAction({ kind: "email", hasRetailer: true })).toEqual({
      id: "create_new_order",
      label: "Start a new order",
    });
  });

  it("an orphaned email with no retailer offers not_a_purchase", () => {
    expect(needsReviewAction({ kind: "email", hasRetailer: false })).toEqual({
      id: "not_a_purchase",
      label: "Archive",
    });
  });

  it("every action id has UI copy (Q9: registry stays safely extensible)", () => {
    for (const id of Object.keys(NEEDS_REVIEW_ACTION_LABELS)) {
      expect(NEEDS_REVIEW_ACTION_LABELS[id as keyof typeof NEEDS_REVIEW_ACTION_LABELS].length).toBeGreaterThan(0);
    }
  });
});

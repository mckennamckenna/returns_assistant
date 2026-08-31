import { describe, it, expect } from "vitest";
import { needsReviewAction, NEEDS_REVIEW_ACTION_LABELS } from "../lib/needsReviewActions";

describe("needsReviewAction", () => {
  it("an order-kind row always degrades to view_detail regardless of reason (2026-08-21 — Link-to-order can't merge Order into Order; see TASKS.md 🟡 Next 'Order-to-order merge action')", () => {
    for (const reasonId of [
      "belongs_to_existing_order",
      "duplicate",
      "real_purchase_no_record",
      "missing_order_date",
      "missing_order_total",
      "uncertain_details",
    ] as const) {
      expect(needsReviewAction({ kind: "order", reasonId })).toEqual({ id: "view_detail", label: "More info" });
    }
  });

  it("an email-kind row detected as belongs_to_existing_order offers link_to_order", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "belongs_to_existing_order" })).toEqual({
      id: "link_to_order",
      label: "Merge with existing order",
    });
  });

  it("an email-kind row detected as duplicate also offers link_to_order (same action, per CARD_SPEC's reason -> action table)", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "duplicate" })).toEqual({
      id: "link_to_order",
      label: "Merge with existing order",
    });
  });

  it("an email-kind row detected as return_or_refund_no_link also offers link_to_order (NEW, NEEDS_REVIEW_ROUTING_DESIGN.md branch 2 — a return/refund implies a prior order exists, so it's Link, never Create)", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "return_or_refund_no_link" })).toEqual({
      id: "link_to_order",
      label: "Merge with existing order",
    });
  });

  it("an email-kind row with the default 'real purchase, no record' reason offers create_new_order", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "real_purchase_no_record" })).toEqual({
      id: "create_new_order",
      label: "Start a new order",
    });
  });

  it("an email-kind row with a degrade-only reason falls back to view_detail (unreachable in the cheap-version email detector today, but the registry must still degrade safely — Q9)", () => {
    for (const reasonId of ["missing_order_date", "missing_order_total", "uncertain_details"] as const) {
      expect(needsReviewAction({ kind: "email", reasonId })).toEqual({ id: "view_detail", label: "More info" });
    }
  });

  it("an email-kind row detected as no_extraction_signal falls back to view_detail via the existing unmapped-reason degrade (NEW reasonId, registered ADDITIVELY — no new branch needed, per NEEDS_REVIEW_ROUTING_DESIGN.md branch 4)", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "no_extraction_signal" })).toEqual({
      id: "view_detail",
      label: "More info",
    });
  });

  it("an email-kind row detected as shipment_unlinked offers link_to_order (carrier-row-disposition Phase 3, 2026-08-28; renamed 2026-08-30)", () => {
    expect(needsReviewAction({ kind: "email", reasonId: "shipment_unlinked" })).toEqual({
      id: "link_to_order",
      label: "Merge with existing order",
    });
  });

  it("every action id has UI copy (Q9: registry stays safely extensible)", () => {
    for (const id of Object.keys(NEEDS_REVIEW_ACTION_LABELS)) {
      expect(NEEDS_REVIEW_ACTION_LABELS[id as keyof typeof NEEDS_REVIEW_ACTION_LABELS].length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from "vitest";
import { orderReviewRow, emailReviewRow } from "../lib/needsReviewRows";

describe("orderReviewRow", () => {
  const order = {
    id: "order-1",
    retailer: "Nordstrom",
    orderNumber: "ABC123",
    orderDate: new Date("2026-07-01"),
    orderTotal: 42,
    orderCurrency: "USD",
    userNote: null as string | null,
    emails: [{ orderNumber: "ABC123" }],
  };

  it("carries the reasonId alongside why, so the action router doesn't need to re-derive it", () => {
    const row = orderReviewRow(order, []);
    expect(row.reasonId).toBe("uncertain_details");
    expect(row.why).toBe("We're not certain about some details on this order.");
    expect(row.kind).toBe("order");
  });

  it("detects belongs_to_existing_order via a mismatched linked email against the candidate list", () => {
    const flagged = { ...order, emails: [{ orderNumber: "OTHER-99" }] };
    const row = orderReviewRow(flagged, [{ id: "order-2", orderNumber: "OTHER-99" }]);
    expect(row.reasonId).toBe("belongs_to_existing_order");
  });
});

describe("emailReviewRow", () => {
  // NEEDS_REVIEW_ROUTING_DESIGN.md §2's four-branch tree (built 2026-08-25):
  // branch 1 exact-match, branch 2 return/refund, branch 3 narrowed
  // purchase-side-with-signal, branch 4 everything-else fallback.
  const email = {
    id: "email-1",
    retailer: "Zara",
    carrier: null as string | null,
    receivedAt: new Date("2026-07-01"),
    orderTotal: 100,
    orderCurrency: "USD",
    orderNumber: null as string | null,
    emailType: "order_confirmation" as string | null,
    retailerSource: null as string | null,
  };

  it("branch 3: real_purchase_no_record when emailType is purchase-side and retailer is present, orderNumber absent", () => {
    const row = emailReviewRow(email, []);
    expect(row.reasonId).toBe("real_purchase_no_record");
    expect(row.why).toBe("This looks like a real purchase with no order record.");
  });

  it("branch 3: real_purchase_no_record still fires with no retailer as long as orderNumber is present", () => {
    const row = emailReviewRow({ ...email, retailer: null, orderNumber: "XYZ-1" }, []);
    expect(row.reasonId).toBe("real_purchase_no_record");
  });

  it("branch 1: detects belongs_to_existing_order when orderNumber exactly matches a candidate order (case-insensitive), ahead of branch 3", () => {
    const withNumber = { ...email, orderNumber: "abc-123" };
    const row = emailReviewRow(withNumber, [{ id: "order-1", orderNumber: "ABC-123" }]);
    expect(row.reasonId).toBe("belongs_to_existing_order");
    expect(row.why).toBe("We think this email belongs to an existing order.");
  });

  it("branch 3: does not match when orderNumber differs from every candidate — falls through to real_purchase_no_record", () => {
    const withNumber = { ...email, orderNumber: "ZZZ-999" };
    const row = emailReviewRow(withNumber, [{ id: "order-1", orderNumber: "ABC-123" }]);
    expect(row.reasonId).toBe("real_purchase_no_record");
  });

  it("branch 2 (NEW): return_label emailType routes to return_or_refund_no_link even with no exact orderNumber match — the H&M-shaped case", () => {
    const row = emailReviewRow({ ...email, emailType: "return_label", retailer: "H&M" }, []);
    expect(row.reasonId).toBe("return_or_refund_no_link");
    expect(row.why).toBe("This looks like a return or refund for an order we don't have on file.");
  });

  it("branch 2 (NEW): refund emailType also routes to return_or_refund_no_link", () => {
    const row = emailReviewRow({ ...email, emailType: "refund" }, []);
    expect(row.reasonId).toBe("return_or_refund_no_link");
  });

  it("branch 2 takes priority over branch 3 even if retailer/orderNumber are present — a return-side email never defaults to Create", () => {
    const row = emailReviewRow({ ...email, emailType: "refund", retailer: "Zara", orderNumber: "ABC-1" }, []);
    expect(row.reasonId).toBe("return_or_refund_no_link");
  });

  it("branch 4 (NEW): real_purchase_no_record is narrowed — purchase-side emailType with no retailer AND no orderNumber falls to no_extraction_signal (generic carrier-tracking residue)", () => {
    const row = emailReviewRow({ ...email, retailer: null, orderNumber: null }, []);
    expect(row.reasonId).toBe("no_extraction_signal");
    expect(row.why).toBe("We couldn't extract any details from this email.");
  });

  it("branch 4 (NEW): null emailType (extraction never ran) falls to no_extraction_signal", () => {
    const row = emailReviewRow({ ...email, emailType: null }, []);
    expect(row.reasonId).toBe("no_extraction_signal");
  });

  it("branch 4 (NEW): non-purchase-side, non-return-side emailType (e.g. 'other') falls to no_extraction_signal", () => {
    const row = emailReviewRow({ ...email, emailType: "other" }, []);
    expect(row.reasonId).toBe("no_extraction_signal");
  });

  // carrier-row-disposition Phase 3 (2026-08-28): a new branch checked
  // before the no_extraction_signal fallback, gated on
  // retailerSource === "carrier_deferred".
  it("carrier branch (NEW): retailerSource === 'carrier_deferred' routes to carrier_tracking_unlinked ahead of the no_extraction_signal fallback", () => {
    const row = emailReviewRow(
      { ...email, retailer: null, orderNumber: null, emailType: null, retailerSource: "carrier_deferred" },
      [],
    );
    expect(row.reasonId).toBe("carrier_tracking_unlinked");
    expect(row.why).toBe("This is a carrier tracking email — link it to the order it belongs to.");
  });

  it("carrier branch (NEW): a row without retailerSource === 'carrier_deferred' is unaffected — still falls to no_extraction_signal", () => {
    const row = emailReviewRow({ ...email, retailer: null, orderNumber: null, emailType: null }, []);
    expect(row.reasonId).toBe("no_extraction_signal");
  });
});

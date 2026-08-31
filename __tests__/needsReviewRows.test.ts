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

  it("branch 3 (widened 2026-08-30): order_confirmation with retailer present and orderNumber absent now routes to shipment_unlinked, not real_purchase_no_record — a zero-candidate order_confirmation still reaches Create new order via the picker's escape hatch (Stage 4), while an extraction-miss on a genuinely-existing order gets a chance to merge", () => {
    const row = emailReviewRow(email, []);
    expect(row.reasonId).toBe("shipment_unlinked");
    expect(row.why).toBe("Shipping or delivery update — link to the correct order.");
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
  it("carrier branch (renamed 2026-08-30): retailerSource === 'carrier_deferred' routes to shipment_unlinked ahead of the no_extraction_signal fallback", () => {
    const row = emailReviewRow(
      { ...email, retailer: null, orderNumber: null, emailType: null, retailerSource: "carrier_deferred" },
      [],
    );
    expect(row.reasonId).toBe("shipment_unlinked");
    expect(row.why).toBe("Shipping or delivery update — link to the correct order.");
  });

  it("carrier branch (NEW): a row without retailerSource === 'carrier_deferred' is unaffected — still falls to no_extraction_signal", () => {
    const row = emailReviewRow({ ...email, retailer: null, orderNumber: null, emailType: null }, []);
    expect(row.reasonId).toBe("no_extraction_signal");
  });

  // shipment_unlinked gate expansion (TASKS.md 🔴 Now, 2026-08-30): a
  // delivery/shipping_confirmation email with a known retailer but no order
  // number used to satisfy branch 3's own (retailer || orderNumber) check
  // and get short-circuited to real_purchase_no_record before ever reaching
  // the carrier_deferred-only branch 4. Two retailer/carrier combinations
  // below to prove the gate is retailer/carrier-agnostic, not an H&M special
  // case.
  it("shipment gate (NEW): delivery email with known retailer, no orderNumber, retailerSource NOT carrier_deferred — the H&M-via-UPS case — routes to shipment_unlinked instead of real_purchase_no_record", () => {
    const row = emailReviewRow(
      { ...email, retailer: "H&M", carrier: "UPS", orderNumber: null, emailType: "delivery", retailerSource: "body_extraction" },
      [],
    );
    expect(row.reasonId).toBe("shipment_unlinked");
    expect(row.why).toBe("Shipping or delivery update — link to the correct order.");
  });

  it("shipment gate (NEW): a second retailer/carrier pairing (Poshmark via USPS) hits the same gate — proves it's not H&M-specific", () => {
    const row = emailReviewRow(
      { ...email, retailer: "Poshmark", carrier: "USPS", orderNumber: null, emailType: "delivery", retailerSource: "body_extraction" },
      [],
    );
    expect(row.reasonId).toBe("shipment_unlinked");
  });

  it("shipment gate (NEW): shipping_confirmation with known retailer and no orderNumber also routes to shipment_unlinked", () => {
    const row = emailReviewRow(
      { ...email, retailer: "Poshmark", carrier: "USPS", orderNumber: null, emailType: "shipping_confirmation", retailerSource: "body_extraction" },
      [],
    );
    expect(row.reasonId).toBe("shipment_unlinked");
  });

  it("shipment gate (widened 2026-08-30): order_confirmation with known retailer and no orderNumber now routes to shipment_unlinked — reversing the same-day Stage 2 exclusion (owner: extraction-miss on order_confirmation is a common live pattern, not rare)", () => {
    const row = emailReviewRow(
      { ...email, retailer: "H&M", orderNumber: null, emailType: "order_confirmation", retailerSource: "body_extraction" },
      [],
    );
    expect(row.reasonId).toBe("shipment_unlinked");
  });

  it("shipment gate (NEW): order_confirmation WITH an orderNumber (unmatched against candidates) still falls to real_purchase_no_record — confirms 'orderNumber absent' is the actual gate condition, not emailType alone", () => {
    const row = emailReviewRow(
      { ...email, retailer: "H&M", orderNumber: "H123456", emailType: "order_confirmation", retailerSource: "body_extraction" },
      [{ id: "order-1", orderNumber: "UNRELATED-1" }],
    );
    expect(row.reasonId).toBe("real_purchase_no_record");
  });

  it("shipment gate (NEW): order_confirmation with no retailer AND no orderNumber falls to no_extraction_signal, same as before widening — confirms the gate still requires a known retailer, not just 'no orderNumber'", () => {
    const row = emailReviewRow(
      { ...email, retailer: null, orderNumber: null, emailType: "order_confirmation", retailerSource: "body_extraction" },
      [],
    );
    expect(row.reasonId).toBe("no_extraction_signal");
  });

  it("shipment gate (NEW): delivery email WITH an orderNumber (just unmatched against candidates) still falls to real_purchase_no_record, not shipment_unlinked — having a number is a different signal than having none", () => {
    const row = emailReviewRow(
      { ...email, retailer: "H&M", orderNumber: "H123456", emailType: "delivery", retailerSource: "body_extraction" },
      [{ id: "order-1", orderNumber: "UNRELATED-1" }],
    );
    expect(row.reasonId).toBe("real_purchase_no_record");
  });
});

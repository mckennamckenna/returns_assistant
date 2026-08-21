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
  const email = {
    id: "email-1",
    retailer: "Zara",
    receivedAt: new Date("2026-07-01"),
    orderTotal: 100,
    orderCurrency: "USD",
    orderNumber: null as string | null,
  };

  it("defaults to real_purchase_no_record when orderNumber is absent (every row here is unlinked by construction)", () => {
    const row = emailReviewRow(email, []);
    expect(row.reasonId).toBe("real_purchase_no_record");
    expect(row.why).toBe("This looks like a real purchase with no order record.");
  });

  it("defaults to real_purchase_no_record even with no retailer — 2026-08-21 scope change: no-retailer is no longer treated as a not-a-purchase signal in the cheap version", () => {
    const row = emailReviewRow({ ...email, retailer: null }, []);
    expect(row.reasonId).toBe("real_purchase_no_record");
  });

  it("detects belongs_to_existing_order when orderNumber exactly matches a candidate order (case-insensitive)", () => {
    const withNumber = { ...email, orderNumber: "abc-123" };
    const row = emailReviewRow(withNumber, [{ id: "order-1", orderNumber: "ABC-123" }]);
    expect(row.reasonId).toBe("belongs_to_existing_order");
    expect(row.why).toBe("We think this email belongs to an existing order.");
  });

  it("does not match when orderNumber differs from every candidate", () => {
    const withNumber = { ...email, orderNumber: "ZZZ-999" };
    const row = emailReviewRow(withNumber, [{ id: "order-1", orderNumber: "ABC-123" }]);
    expect(row.reasonId).toBe("real_purchase_no_record");
  });
});

import { describe, it, expect } from "vitest";
import { reviewReasonLabel } from "../lib/orderReview";

const base = {
  orderNumber: "ABC123",
  orderDate: new Date("2026-07-01"),
  orderTotal: 42,
  userNote: null as string | null,
  retailer: "Nordstrom",
  returnPortalUrl: "https://www.nordstrom.com/returns",
  policySource: "stated_in_email" as string | null,
  emails: [{ orderNumber: "ABC123", confidence: "high" }],
};

describe("reviewReasonLabel", () => {
  it("surfaces the specific retailer-prefix-merge reason when userNote has the [auto] marker — the real-world AquaTru/AquaTru Water case", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
    };
    expect(reviewReasonLabel(order)).toBe(
      'This looks like it might be the same order as an existing "AquaTru" purchase — please confirm',
    );
  });

  it("prefers the [auto] marker over an order-number mismatch when both are present", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
      emails: [{ orderNumber: "DIFFERENT", confidence: "high" }],
    };
    expect(reviewReasonLabel(order)).toContain("AquaTru");
  });

  it("falls back to the order-number-mismatch message when no [auto] marker exists", () => {
    const order = { ...base, emails: [{ orderNumber: "DIFFERENT", confidence: "high" }] };
    expect(reviewReasonLabel(order)).toBe("We matched this return email to an existing order — please confirm it's correct");
  });

  it("surfaces the M2 unverified-return-link reason, re-derived live rather than stored", () => {
    const order = { ...base, returnPortalUrl: "https://u24515401.ct.sendgrid.net/ls/click?upn=abc" };
    expect(reviewReasonLabel(order)).toBe(
      "The return link on this order could not be verified against the retailer's domain",
    );
  });

  it("does not surface the M2 reason for a known third-party return portal", () => {
    const order = { ...base, returnPortalUrl: "https://api.loopreturns.com/api/redirect/return/123" };
    expect(reviewReasonLabel(order)).toBe("This order needs a quick check");
  });

  it("prefers the order-number-mismatch reason over M2 when both apply", () => {
    const order = {
      ...base,
      returnPortalUrl: "https://u24515401.ct.sendgrid.net/ls/click?upn=abc",
      emails: [{ orderNumber: "DIFFERENT", confidence: "high" }],
    };
    expect(reviewReasonLabel(order)).toBe("We matched this return email to an existing order — please confirm it's correct");
  });

  it("reports a missing purchase date", () => {
    const order = { ...base, orderDate: null };
    expect(reviewReasonLabel(order)).toBe("We couldn't find a purchase date — the return deadline may be estimated");
  });

  it("reports low confidence when present and other signals are fine", () => {
    const order = { ...base, emails: [{ orderNumber: "ABC123", confidence: "low" }] };
    expect(reviewReasonLabel(order)).toBe("We're not certain about some details on this order");
  });

  it("reports a missing order total", () => {
    const order = { ...base, orderTotal: null };
    expect(reviewReasonLabel(order)).toBe("Order total couldn't be found");
  });

  it("falls back to the generic message when nothing more specific applies", () => {
    expect(reviewReasonLabel(base)).toBe("This order needs a quick check");
  });

  it("does not match a userNote that merely mentions [auto] without the exact merge format", () => {
    const order = { ...base, userNote: "[auto] something unrelated" };
    expect(reviewReasonLabel(order)).toBe("This order needs a quick check");
  });
});

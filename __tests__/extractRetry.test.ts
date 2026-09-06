import { vi, describe, it, expect, beforeEach } from "vitest";

// Two-pass retry (TASKS.md 2026-08-22, H&M return_label case): when the
// primary body's extraction resolves a retailer but not an orderNumber, and
// resolveBodyTextWithAlternate offered a real alternate body, extractEmail
// retries against that alternate and takes ONLY orderNumber from it. Same
// vi.hoisted/vi.mock pattern as extractUsageLogging.test.ts — mockCreate
// must exist before the vi.mock factory runs, and the SDK must be mocked
// before lib/extract's module-level `anthropic` instance is constructed.
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

const { extractEmail, extractEmailIdentity } = await import("../lib/extract");

function apiResponse(jsonBody: object) {
  return {
    content: [{ type: "text", text: JSON.stringify(jsonBody) }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      output_tokens_details: null,
      service_tier: "standard",
      inference_geo: null,
    },
  };
}

// Resolves without a policy lookup (returnWindowDays stated) so every test
// below makes exactly one extra call, at most, beyond the primary pass.
const BASE = {
  emailType: "return_label" as const,
  retailer: "H&M",
  orderNumber: null as string | null,
  orderDate: "2026-08-19",
  deliveryDate: null,
  shipByDate: null,
  returnWindowDays: 30,
  returnWindowStartsFrom: "order_date" as const,
  orderTotal: null,
  orderCurrency: null,
  refundAmount: null,
  refundAmountConfidence: null,
  lineItems: [],
  returnPortalUrlFromEmail: null,
  confidence: "high" as const,
  needsReview: false,
  notes: "Order number not found in the provided body.",
};

const SUBJECT = "We've received your return request";
const PRIMARY_BODY = "primary body text, order number only in a URL";
const ALTERNATE_BODY = "alternate body text, Order number 68462778273 present as labeled text";

beforeEach(() => {
  mockCreate.mockReset();
});

describe("extractEmail — two-pass retry", () => {
  it("retries against the alternate body and recovers orderNumber when the primary pass came back null", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, orderNumber: "68462778273" }));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_hm", ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.orderNumber).toBe("68462778273");
    expect(result.notes).toContain("recovered from alternate body source on retry");
  });

  it("takes needsReview from the retry, not the primary pass's stale self-report — a row whose primary pass flagged needsReview solely because orderNumber was missing must leave the needs-review bucket once the retry recovers it", async () => {
    // Primary pass: needsReview true (it couldn't find orderNumber).
    // Retry pass: saw the order number directly, needsReview false.
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, needsReview: true }));
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, orderNumber: "68462778273", needsReview: false }));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_hm_needsreview", ALTERNATE_BODY);

    expect(result.orderNumber).toBe("68462778273");
    expect(result.needsReview).toBe(false);
  });

  it("keeps needsReview true when the retry recovers orderNumber but still finds something else genuinely ambiguous", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, needsReview: true }));
    mockCreate.mockResolvedValueOnce(
      apiResponse({ ...BASE, orderNumber: "68462778273", needsReview: true, confidence: "low" }),
    );

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_hm_still_ambiguous", ALTERNATE_BODY);

    expect(result.orderNumber).toBe("68462778273");
    expect(result.needsReview).toBe(true);
  });

  it("does not retry when no alternate body is offered", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_no_alt", null);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.orderNumber).toBeNull();
  });

  it("does not retry when the primary pass already found an orderNumber", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, orderNumber: "already-found" }));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_found", ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.orderNumber).toBe("already-found");
  });

  it("does not retry when retailer is null — the Zara shape, a different mechanism with its own fix", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, retailer: null }));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_zara_shape", ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.orderNumber).toBeNull();
  });

  it("does not retry when emailType is \"other\"", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, emailType: "other" }));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_other", ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("does not retry when the alternate body is identical to the primary body", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_identical", PRIMARY_BODY);

    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("retries but leaves orderNumber null when the retry also comes back without one — no crash, no false recovery note", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));

    const result = await extractEmail(PRIMARY_BODY, SUBJECT, "email_retry_also_null", ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.orderNumber).toBeNull();
    expect(result.notes).not.toContain("recovered from alternate body source on retry");
  });

  it("logs the retry call under its own callSite for cost visibility", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce(apiResponse(BASE));
    mockCreate.mockResolvedValueOnce(apiResponse({ ...BASE, orderNumber: "68462778273" }));

    await extractEmail(PRIMARY_BODY, SUBJECT, "email_logging", ALTERNATE_BODY);

    const events = consoleSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(events[0]).toMatchObject({ callSite: "email_extraction" });
    expect(events[1]).toMatchObject({ callSite: "email_extraction_retry" });

    consoleSpy.mockRestore();
  });
});

// Widened retry trigger + gap-fill write-scope (TASKS.md 2026-09-06, Gap
// order_confirmation case): a second shape besides H&M's — orderNumber
// sourced from the subject line (non-null after pass 1) while the body pass
// 1 actually used was pure boilerplate, so every body-content-dependent
// field came back null. The gate widens to catch this shape, and the merge
// widens from "orderNumber + needsReview only" to gap-filling any of
// orderDate/orderTotal/lineItems/returnWindowDays pass 1 left null.
const GAP_BASE = {
  emailType: "order_confirmation" as const,
  retailer: "Gap",
  orderNumber: "1RYJR48" as string | null,
  orderDate: null as string | null,
  deliveryDate: null,
  shipByDate: null,
  returnWindowDays: null as number | null,
  returnWindowStartsFrom: null,
  orderTotal: null as number | null,
  orderCurrency: null,
  refundAmount: null,
  refundAmountConfidence: null,
  lineItems: [] as { name: string }[],
  returnPortalUrlFromEmail: null,
  confidence: "low" as const,
  needsReview: true,
  notes: "Order number read from subject line. No order date, items, prices, totals, or return policy information are present in the body.",
};

const GAP_SUBJECT = "Order Confirmation #1RYJR48";
const GAP_PRIMARY_BODY = "Order Confirmation: This is not your receipt. [Gap branding boilerplate, no order data]";
const GAP_ALTERNATE_BODY = "ORDER CONFIRMATION\n1RYJR48\nYour order has been received.\nTotal $254.14";

describe("extractEmailIdentity — widened gate + gap-fill (2026-09-06)", () => {
  it("fires the retry for the Gap-Inc shape (orderNumber already non-null, all body fields null on an order_confirmation) and gap-fills the missing fields", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(GAP_BASE));
    mockCreate.mockResolvedValueOnce(
      apiResponse({
        ...GAP_BASE,
        orderDate: "2026-09-01",
        orderTotal: 254.14,
        returnWindowDays: 45,
        lineItems: [{ name: "Jeans" }],
        needsReview: false,
      }),
    );

    const result = await extractEmailIdentity(GAP_PRIMARY_BODY, GAP_SUBJECT, "email_gap", GAP_ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.orderDate).toBe("2026-09-01");
    expect(result.orderTotal).toBe(254.14);
    expect(result.returnWindowDays).toBe(45);
    expect(result.lineItems).toEqual([{ name: "Jeans" }]);
    expect(result.notes).toContain("recovered from alternate body source on retry");
    expect(result.notes).toContain("orderDate");
    expect(result.notes).toContain("orderTotal");
    expect(result.notes).toContain("lineItems");
    expect(result.notes).toContain("returnWindowDays");
  });

  it("does not gap-fill when pass 1 already has real values — pass 1 wins even when pass 2 disagrees", async () => {
    // orderNumber null on pass 1 fires the retry via the classic (H&M) gate
    // regardless of the other three fields' state, so this can exercise a
    // pass-1-partially-populated shape that hasNoBodyContent alone couldn't
    // (that gate requires all four body fields null to fire).
    mockCreate.mockResolvedValueOnce(
      apiResponse({ ...GAP_BASE, orderNumber: null, orderDate: "2026-08-30", needsReview: true }),
    );
    mockCreate.mockResolvedValueOnce(
      apiResponse({
        ...GAP_BASE,
        orderNumber: "1RYJR48",
        orderDate: "2026-09-15", // wrong — pass 1 already had a real value here
        orderTotal: 1000, // genuinely new — pass 1 had null
        returnWindowDays: 45, // genuinely new — pass 1 had null
        needsReview: false,
      }),
    );

    const result = await extractEmailIdentity(GAP_PRIMARY_BODY, GAP_SUBJECT, "email_gap_partial", GAP_ALTERNATE_BODY);

    // orderDate is populated on pass 1 above and must survive untouched;
    // orderNumber/orderTotal/returnWindowDays were null on pass 1 and should gap-fill.
    expect(result.orderDate).toBe("2026-08-30");
    expect(result.orderNumber).toBe("1RYJR48");
    expect(result.orderTotal).toBe(1000);
    expect(result.returnWindowDays).toBe(45);
  });

  it("does not fire the retry for a shipping_confirmation with all body fields null — the emailType guard", async () => {
    mockCreate.mockResolvedValueOnce(
      apiResponse({ ...GAP_BASE, emailType: "shipping_confirmation" as unknown as typeof GAP_BASE.emailType }),
    );

    const result = await extractEmailIdentity(GAP_PRIMARY_BODY, GAP_SUBJECT, "email_shipping_conf", GAP_ALTERNATE_BODY);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.orderDate).toBeNull();
  });

  it("propagates the retry's own low-confidence/needsReview through a gap-fill merge, rather than reading filled-fields-plus-cleared-needsReview as upgraded confidence", async () => {
    // Pass 1: high confidence but missing body fields (Gap Inc. shape).
    // Pass 2: low confidence, still flags needsReview, but DOES fill fields.
    // This is the exact combination the propagation guard protects: a naive
    // "fields got filled, so needsReview should clear" would fail this test.
    mockCreate.mockResolvedValueOnce(apiResponse({ ...GAP_BASE, confidence: "high", needsReview: true }));
    mockCreate.mockResolvedValueOnce(
      apiResponse({
        ...GAP_BASE,
        orderDate: "2026-09-01",
        orderTotal: 254.14,
        confidence: "low",
        needsReview: true,
        notes: "Alternate body had some data but the return policy is still ambiguous.",
      }),
    );

    const result = await extractEmailIdentity(GAP_PRIMARY_BODY, GAP_SUBJECT, "email_gap_low_confidence_retry", GAP_ALTERNATE_BODY);

    expect(result.orderDate).toBe("2026-09-01");
    expect(result.orderTotal).toBe(254.14);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBe("high"); // untouched by gap-fill, stays sourced from pass 1
  });
});

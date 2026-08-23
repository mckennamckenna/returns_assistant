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

const { extractEmail } = await import("../lib/extract");

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

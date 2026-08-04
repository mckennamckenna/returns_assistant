import { vi, describe, it, expect, beforeEach } from "vitest";

// Same vi.hoisted/vi.mock pattern as classify.test.ts — mockCreate must be
// initialised before the vi.mock factory runs, and the SDK must be mocked
// before lib/extract's module-level `anthropic` instance is constructed.
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

const { extractEmail } = await import("../lib/extract");

function usageResponse(
  jsonBody: object,
  usage: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    server_tool_use: { web_search_requests: number; web_fetch_requests: number } | null;
  }> = {},
) {
  return {
    content: [{ type: "text", text: JSON.stringify(jsonBody) }],
    usage: {
      input_tokens: usage.input_tokens ?? 100,
      output_tokens: usage.output_tokens ?? 50,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
      server_tool_use: usage.server_tool_use ?? null,
      output_tokens_details: null,
      service_tier: "standard",
      inference_geo: null,
    },
  };
}

// Baseline RawExtraction JSON that resolves without a policy lookup
// (returnWindowDays stated in the email itself) — most tests override
// specific fields.
const BASE_EXTRACTION = {
  emailType: "order_confirmation" as const,
  retailer: "Acme",
  orderNumber: "12345",
  orderDate: "2026-07-01",
  deliveryDate: null,
  shipByDate: null,
  returnWindowDays: 30,
  returnWindowStartsFrom: "order_date" as const,
  orderTotal: 49.99,
  orderCurrency: "USD",
  refundAmount: null,
  refundAmountConfidence: null,
  lineItems: [{ name: "Acme Widget — a very specific secret item name", price: 49.99, quantity: 1 }],
  returnPortalUrlFromEmail: null,
  confidence: "high" as const,
  needsReview: false,
  notes: "Order total read directly from the email.",
};

const SECRET_SUBJECT = "Your Acme order #12345 secret-subject-marker";
const SECRET_BODY = "Dear customer secret-body-marker, your order has shipped.";

beforeEach(() => {
  mockCreate.mockReset();
});

describe("extractEmail — usage logging", () => {
  it("emits a usage event after a successful mocked extraction call", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce(usageResponse(BASE_EXTRACTION, { input_tokens: 1200, output_tokens: 300 }));

    await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_123");

    expect(consoleSpy).toHaveBeenCalledOnce();
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event).toMatchObject({
      event: "anthropic_usage",
      callSite: "email_extraction",
      model: "claude-sonnet-4-6",
      inputTokens: 1200,
      outputTokens: 300,
      bodyCharacterCount: SECRET_BODY.length,
      emailId: "email_123",
      webSearchRequests: 0,
    });

    consoleSpy.mockRestore();
  });

  it("emits a usage event including the web-search request count on the policy_lookup call, when a lookup is triggered", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockCreate.mockResolvedValueOnce(
      usageResponse({ ...BASE_EXTRACTION, returnWindowDays: null, returnWindowStartsFrom: null }),
    );
    mockCreate.mockResolvedValueOnce(
      usageResponse(
        {
          returnWindowDays: 45,
          returnWindowStartsFrom: "delivery_date",
          returnPortalUrl: "https://acme.com/returns",
          confidence: "high",
          needsReview: false,
          notes: "Found on the official policy page.",
        },
        { server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
      ),
    );

    await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_456");

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    const lookupEvent = JSON.parse(consoleSpy.mock.calls[1][0] as string);
    expect(lookupEvent).toMatchObject({
      event: "anthropic_usage",
      callSite: "policy_lookup",
      retailer: "Acme",
      emailId: "email_456",
      webSearchRequests: 2,
    });

    consoleSpy.mockRestore();
  });

  it("no logged event contains body, prompt, subject, or line-item content", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockCreate.mockResolvedValueOnce(
      usageResponse({ ...BASE_EXTRACTION, returnWindowDays: null, returnWindowStartsFrom: null }),
    );
    mockCreate.mockResolvedValueOnce(
      usageResponse(
        {
          returnWindowDays: 45,
          returnWindowStartsFrom: "delivery_date",
          returnPortalUrl: "https://acme.com/returns",
          confidence: "high",
          needsReview: false,
          notes: "Found on the official policy page.",
        },
        { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
      ),
    );

    await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_789");

    const loggedText = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(loggedText).not.toContain(SECRET_BODY);
    expect(loggedText).not.toContain(SECRET_SUBJECT);
    expect(loggedText).not.toContain("secret-body-marker");
    expect(loggedText).not.toContain("secret-subject-marker");
    expect(loggedText).not.toContain("Acme Widget");

    consoleSpy.mockRestore();
  });
});

describe("extractEmail — never research \"other\" emails (Part 2 gate)", () => {
  it("produces zero policy-lookup API calls when emailType is \"other\", even with a non-null retailer and null returnWindowDays", async () => {
    mockCreate.mockResolvedValueOnce(
      usageResponse({
        ...BASE_EXTRACTION,
        emailType: "other",
        retailer: "Some Marketing Sender",
        returnWindowDays: null,
        returnWindowStartsFrom: null,
      }),
    );

    const result = await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_other");

    // Exactly one call — the extraction call itself. The lookup's own
    // anthropic.messages.create was never reached.
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("the \"other\" skip is silent: leaves policySource null and does not mark the lookup unclear", async () => {
    mockCreate.mockResolvedValueOnce(
      usageResponse({
        ...BASE_EXTRACTION,
        emailType: "other",
        retailer: "Some Marketing Sender",
        returnWindowDays: null,
        returnWindowStartsFrom: null,
      }),
    );

    const result = await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_other");

    expect(result.policySource).toBeNull();
    // policyLookupWasUnclear isn't part of the public return type, but it's
    // only ever set to true inside the lookup branch this gate skips — the
    // absence of any "unclear"/"web lookup" annotation on notes and the
    // single mockCreate call above together confirm that branch never ran.
    expect(result.notes).toBe(BASE_EXTRACTION.notes);
    expect(result.notes).not.toContain("unclear");
    expect(result.notes).not.toContain("web lookup");
  });

  it("a qualifying order_confirmation (retailer set, no in-email window, not \"other\") still performs the policy lookup", async () => {
    mockCreate.mockResolvedValueOnce(
      usageResponse({
        ...BASE_EXTRACTION,
        emailType: "order_confirmation",
        returnWindowDays: null,
        returnWindowStartsFrom: null,
      }),
    );
    mockCreate.mockResolvedValueOnce(
      usageResponse({
        returnWindowDays: 45,
        returnWindowStartsFrom: "delivery_date",
        returnPortalUrl: "https://acme.com/returns",
        confidence: "high",
        needsReview: false,
        notes: "Found on the official policy page.",
      }),
    );

    const result = await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_qualifying");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.policySource).toBe("web_lookup");
    expect(result.returnWindowDays).toBe(45);
  });

  it("delivery and shipping_confirmation types remain eligible for the lookup — the gate is scoped to \"other\" only", async () => {
    for (const emailType of ["delivery", "shipping_confirmation"] as const) {
      mockCreate.mockReset();
      mockCreate.mockResolvedValueOnce(
        usageResponse({
          ...BASE_EXTRACTION,
          emailType,
          returnWindowDays: null,
          returnWindowStartsFrom: null,
        }),
      );
      mockCreate.mockResolvedValueOnce(
        usageResponse({
          returnWindowDays: 45,
          returnWindowStartsFrom: "delivery_date",
          returnPortalUrl: "https://acme.com/returns",
          confidence: "high",
          needsReview: false,
          notes: "Found on the official policy page.",
        }),
      );

      await extractEmail(SECRET_BODY, SECRET_SUBJECT, `email_${emailType}`);

      expect(mockCreate).toHaveBeenCalledTimes(2);
    }
  });
});

describe("extractEmail — non-\"other\" paths are behaviorally unchanged", () => {
  it("an order_confirmation with an in-email window still resolves policySource: \"email\" and skips the lookup entirely", async () => {
    mockCreate.mockResolvedValueOnce(usageResponse(BASE_EXTRACTION));

    const result = await extractEmail(SECRET_BODY, SECRET_SUBJECT, "email_inbody");

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.policySource).toBe("email");
    expect(result.returnWindowDays).toBe(30);
    expect(result.retailer).toBe("Acme");
    expect(result.orderNumber).toBe("12345");
  });
});

import { vi, describe, it, expect, beforeEach } from "vitest";

// Root cause (a), TASKS.md 2026-09-21 H&M incident: a carrier notification
// with no order number must never reach a billed web-search policy lookup,
// whatever the body named as the retailer.
//
// These are the first tests of finalizeExtraction's own branch logic. The
// note at runExtraction.test.ts:180 said that branch "isn't unit-tested
// here or there" because doing so "would require mocking the Anthropic SDK,
// which no test in this codebase does today" — that was true when written
// and is now stale: extractRetry, extractUsageLogging, classify and
// anthropicUsage all mock it. This file reuses that same vi.hoisted pattern.
//
// How the assertion works: extraction itself happens in
// extractEmailIdentity, a SEPARATE function. The ONLY Anthropic call inside
// finalizeExtraction is lookupReturnPolicy, so mockCreate's call count IS
// the lookup count. Zero real API calls are made by this file.
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock("@/lib/anthropicUsage", () => ({ logAnthropicUsage: vi.fn() }));

const { finalizeExtraction } = await import("../lib/extract");

// What a successful policy lookup looks like coming back off the wire.
function policyLookupResponse(days: number) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          returnWindowDays: days,
          returnWindowStartsFrom: "delivery_date",
          returnPortalUrl: null,
          confidence: "high",
          needsReview: false,
          notes: `Policy says ${days} days.`,
        }),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

// A carrier notification as it actually arrives: the body named a retailer
// (that is the whole problem), but there is no order number and no policy
// text of its own.
function parsed(overrides: Record<string, unknown> = {}) {
  return {
    emailType: "shipping_confirmation" as const,
    retailer: "H&M",
    orderNumber: null as string | null,
    orderDate: "2026-09-18",
    deliveryDate: null,
    shipByDate: null,
    deliveredAt: null,
    estimatedDeliveryDate: null,
    returnWindowDays: null as number | null,
    returnWindowStartsFrom: null,
    orderTotal: null,
    orderCurrency: null,
    refundAmount: null,
    refundAmountConfidence: null,
    lineItems: [],
    returnPortalUrlFromEmail: null,
    confidence: "high" as const,
    needsReview: false,
    notes: "",
    ...overrides,
  };
}

describe("finalizeExtraction — carrier sender policy-lookup gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(policyLookupResponse(3));
  });

  // (1) The incident itself.
  it("carrier sender + body names a retailer + NO order number -> lookup never fires", async () => {
    const result = await finalizeExtraction(parsed(), "email1", null, "H&M", null, true);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.returnWindowDays).toBeNull();
    expect(result.policySource).toBeNull();
    // Retailer resolution is deliberately untouched by this gate.
    expect(result.retailer).toBe("H&M");
  });

  // (2) The ALDO case — carrier senders WITH an order number keep today's
  // behavior, because they have real dependents (2 sole-source orders in
  // the 09-22 census). Blocking these would destroy a window source.
  it("carrier sender WITH an order number, parent order has no window -> lookup still fires", async () => {
    const result = await finalizeExtraction(
      parsed({ orderNumber: "S400989570", retailer: "ALDO" }),
      "email2",
      { returnWindowDays: null },
      "ALDO",
      null,
      true,
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.returnWindowDays).toBe(3);
    expect(result.policySource).toBe("web_lookup");
  });

  // (3) The pre-existing existingOrder skip, unchanged by this fix.
  it("carrier sender WITH an order number, parent order ALREADY has a window -> lookup skipped", async () => {
    await finalizeExtraction(
      parsed({ orderNumber: "S400989570", retailer: "ALDO" }),
      "email3",
      { returnWindowDays: 30 },
      "ALDO",
      null,
      true,
    );

    expect(mockCreate).not.toHaveBeenCalled();
  });

  // (5) Earlier branch wins: a carrier email that STATES a window keeps it
  // as policySource "email" and never reaches the lookup gate at all.
  it("carrier sender whose email STATES a window -> stated window used, no lookup", async () => {
    const result = await finalizeExtraction(
      parsed({ returnWindowDays: 30, returnWindowStartsFrom: "delivery_date" }),
      "email5",
      null,
      "H&M",
      null,
      true,
    );

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.returnWindowDays).toBe(30);
    expect(result.policySource).toBe("email");
  });

  // (6) The fix must NOT broaden into PHASE 1c. A retailer-domain sender
  // with no order number still looks up, exactly as before — those rows
  // have 7 dependents in the census and are a separate, undecided question.
  it("NON-carrier sender, no order number -> lookup still fires (PHASE 1c is not this fix)", async () => {
    const result = await finalizeExtraction(parsed({ retailer: "Bloomingdale's" }), "email6", null, "Bloomingdale's", null, false);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.policySource).toBe("web_lookup");
  });

  // (7) The Amazon short-circuit runs BEFORE this gate and is unaffected.
  it("carrier sender whose effectiveRetailer is Amazon -> amazon_default branch, unchanged", async () => {
    const result = await finalizeExtraction(parsed({ retailer: "Amazon" }), "email7", null, "Amazon", null, true);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.policySource).toBe("amazon_default");
    expect(result.returnWindowDays).toBe(30);
  });

  // The default matters: extractEmail and the audit-script callers don't
  // pass this argument, and must keep their previous behavior exactly.
  it("senderIsCarrier defaults to false -> omitting the argument preserves old behavior", async () => {
    await finalizeExtraction(parsed(), "email8", null, "H&M", null);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // The gate needs BOTH conditions. Neither alone may block.
  it("the gate is the INTERSECTION: carrier-with-number and non-carrier-without-number both still look up", async () => {
    await finalizeExtraction(parsed({ orderNumber: "ABC12345" }), "email9", null, "H&M", null, true);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockCreate.mockResolvedValue(policyLookupResponse(3));

    await finalizeExtraction(parsed(), "email10", null, "H&M", null, false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

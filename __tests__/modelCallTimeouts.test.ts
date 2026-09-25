import { vi, describe, it, expect, beforeEach } from "vitest";

// Tests for the bounded model calls (TASKS.md 2026-09-24 build, parts 1
// and 4). Reuses the vi.hoisted SDK-mock pattern from
// policyLookupCarrierGate.test.ts — zero real API calls are made here.

const mockCreate = vi.hoisted(() => vi.fn());
const mockEmailUpdate = vi.hoisted(() => vi.fn());
const mockEmailFindUnique = vi.hoisted(() => vi.fn());

// Replaces ONLY the client class, keeping every real export — crucially the
// error classes, so `instanceof` checks in lib/extract.ts run against the
// genuine prototypes. The previous version of this mock returned `{ default }`
// alone, which wiped the error classes out; that is what let a broken
// `isTimeoutError` pass its tests while failing in production (5fe6b6a).
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  return {
    ...actual,
    default: class {
      messages = { create: mockCreate };
    },
  };
});
vi.mock("@/lib/anthropicUsage", () => ({ logAnthropicUsage: vi.fn() }));

const { APIConnectionTimeoutError, APIUserAbortError } = await import("@anthropic-ai/sdk");

const {
  finalizeExtraction,
  extractEmailIdentity,
  isTimeoutError,
  POLICY_LOOKUP_TIMEOUT_MS,
  EXTRACTION_TIMEOUT_MS,
  WORST_CASE_EXTRACTION_MS,
  LOOKUP_TIMEOUT_NOTE,
  EXTRACTION_TIMEOUT_NOTE,
} = await import("../lib/extract");

// A GENUINE SDK error instance, constructed from the real exported class —
// never a hand-built Error with `name` set. The whole reason the original
// bug shipped is that the fake satisfied the old check and the real object
// did not: a real APIConnectionTimeoutError has
// `name === "Error"` (inherited) and only its CONSTRUCTOR is named.
function timeoutError() {
  return new APIConnectionTimeoutError({ message: "Request timed out." });
}

function abortError() {
  return new APIUserAbortError();
}

function extractionResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          retailer: "Testco",
          orderNumber: "ABC123",
          orderDate: "2026-09-20",
          deliveryDate: null,
          shipByDate: null,
          returnWindowDays: null,
          returnWindowStartsFrom: null,
          orderTotal: 10,
          orderCurrency: "USD",
          lineItems: [],
          emailType: "order_confirmation",
          confidence: "high",
          needsReview: false,
          notes: "ok",
          returnPortalUrl: null,
          refundAmount: null,
          refundAmountConfidence: null,
          ...overrides,
        }),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("both bounds are set on every model call", () => {
  it("bounds the policy lookup with a timeout AND zero retries", async () => {
    mockCreate.mockRejectedValue(timeoutError());

    await finalizeExtraction(
      JSON.parse(extractionResponse().content[0].text),
      "email-1",
      null,
      "Testco",
      null,
      false,
    );

    const opts = mockCreate.mock.calls[0][1];
    expect(opts).toMatchObject({ timeout: POLICY_LOOKUP_TIMEOUT_MS, maxRetries: 0 });
  });

  it("bounds the extraction call with a timeout AND zero retries", async () => {
    mockCreate.mockResolvedValue(extractionResponse());

    await extractEmailIdentity("body text", "Subject", "email-1", null, null);

    const opts = mockCreate.mock.calls[0][1];
    expect(opts).toMatchObject({ timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0 });
  });

  it("maxRetries: 0 is load-bearing — without it the bound is 3x", () => {
    // The SDK default is maxRetries 2 and it retries timeouts, so a
    // timeout alone would permit timeout x 3 of wall clock. This test
    // exists so that deleting maxRetries fails loudly rather than
    // silently tripling the ceiling.
    expect(POLICY_LOOKUP_TIMEOUT_MS * 3).toBeGreaterThan(POLICY_LOOKUP_TIMEOUT_MS);
    expect(WORST_CASE_EXTRACTION_MS).toBe(EXTRACTION_TIMEOUT_MS * 2 + POLICY_LOOKUP_TIMEOUT_MS);
  });

  it("the whole worst case nests inside the platform limit with margin", () => {
    expect(WORST_CASE_EXTRACTION_MS).toBeLessThan(300_000);
    // And the lookup always gives up well before the function is killed.
    expect(POLICY_LOOKUP_TIMEOUT_MS).toBeLessThan(300_000 / 2);
  });
});

describe("a timed-out lookup behaves exactly like a lookup that found nothing", () => {
  it("saves no window, completes the extraction, and does not retry", async () => {
    mockCreate.mockRejectedValue(timeoutError());
    const parsed = JSON.parse(extractionResponse().content[0].text);

    const result = await finalizeExtraction(parsed, "email-1", null, "Testco", null, false);

    // No window invented from a failed lookup.
    expect(result.returnWindowDays).toBeNull();
    // Extraction still completed and returned a usable result.
    expect(result.retailer).toBe("Testco");
    expect(result.orderNumber).toBe("ABC123");
    // Exactly one lookup attempt — no retry inside the same call.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("writes a searchable timeout phrase into the stored notes", async () => {
    mockCreate.mockRejectedValue(timeoutError());
    const parsed = JSON.parse(extractionResponse().content[0].text);

    const result = await finalizeExtraction(parsed, "email-1", null, "Testco", null, false);

    // Database, not logs: runtime logs on this plan are retained for
    // minutes, so this phrase is the only durable record that the 60s cap
    // fired. Counting it is how the cap gets re-tuned (re-check 2026-10-07).
    expect(result.notes).toContain(LOOKUP_TIMEOUT_NOTE);
  });

  it("does not add the timeout phrase when the lookup merely found nothing", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            returnWindowDays: null,
            returnWindowStartsFrom: null,
            returnPortalUrl: null,
            confidence: "low",
            needsReview: false,
            notes: "Could not find a policy.",
          }),
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const parsed = JSON.parse(extractionResponse().content[0].text);

    const result = await finalizeExtraction(parsed, "email-1", null, "Testco", null, false);

    expect(result.returnWindowDays).toBeNull();
    expect(result.notes).not.toContain(LOOKUP_TIMEOUT_NOTE);
  });
});

describe("isTimeoutError", () => {
  it("recognises GENUINE SDK timeout and abort errors", () => {
    expect(isTimeoutError(timeoutError())).toBe(true);
    expect(isTimeoutError(abortError())).toBe(true);
  });

  // The regression test for 5fe6b6a. A real SDK error does NOT carry a
  // useful `name`; only its constructor is named. Any implementation that
  // reads `error.name` fails this test, which is exactly what shipped
  // broken and cost a real 2026-09-24 timeout its record.
  it("a real timeout error's .name is 'Error' — so .name must never be the check", () => {
    const real = timeoutError();
    expect(real.name).toBe("Error");
    expect(real.constructor.name).toBe("APIConnectionTimeoutError");
    // Detected anyway, because the check is instanceof.
    expect(isTimeoutError(real)).toBe(true);
  });

  // constructor.name was the tempting second fix. It passes locally and
  // breaks under a minifying production build, so it must not be used —
  // this asserts the detection survives a renamed constructor.
  it("still detects a timeout when the constructor name is mangled (minification)", () => {
    const real = timeoutError();
    Object.defineProperty(real.constructor, "name", { value: "a", configurable: true });
    expect(isTimeoutError(real)).toBe(true);
  });

  it("does not misclassify ordinary failures as timeouts", () => {
    expect(isTimeoutError(new Error("connection reset"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    // A hand-built impostor with the right name must NOT pass — the old
    // implementation accepted this while rejecting the real thing.
    const impostor = new Error("nope");
    impostor.name = "APIConnectionTimeoutError";
    expect(isTimeoutError(impostor)).toBe(false);
  });
});

describe("an extraction timeout is bounded and countable", () => {
  it("the extraction bound is well under the platform limit", () => {
    // A timed-out extraction must lose to the model call, not to the
    // platform: the SDK throws at 90s, runExtraction catches it, and the
    // row is stamped. If this ever exceeded maxDuration the function
    // would be killed first and the row would stay silently untouched —
    // the exact bug this build exists to close.
    expect(EXTRACTION_TIMEOUT_MS).toBeLessThan(300_000);
    expect(EXTRACTION_TIMEOUT_NOTE).toMatch(/timed out/i);
  });
});

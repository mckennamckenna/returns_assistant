import { vi, describe, it, expect, afterEach } from "vitest";
import { logAnthropicUsage } from "../lib/anthropicUsage";

const BASE_USAGE = {
  input_tokens: 500,
  output_tokens: 120,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  server_tool_use: null,
  output_tokens_details: null,
  service_tier: "standard" as const,
  inference_geo: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAnthropicUsage", () => {
  it("emits a single structured JSON line with the documented token fields", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({ callSite: "commerce_classifier", model: "claude-haiku-4-5-20251001", usage: BASE_USAGE });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event).toEqual({
      event: "anthropic_usage",
      callSite: "commerce_classifier",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 500,
      outputTokens: 120,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      webSearchRequests: 0,
    });
  });

  it("defaults webSearchRequests to 0 when server_tool_use is null (non-web-search call sites)", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({ callSite: "email_extraction", model: "claude-sonnet-4-6", usage: BASE_USAGE });

    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.webSearchRequests).toBe(0);
  });

  it("reads webSearchRequests from usage.server_tool_use.web_search_requests when present", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({
      callSite: "policy_lookup",
      model: "claude-sonnet-4-6",
      usage: { ...BASE_USAGE, server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } },
      retailer: "Acme",
    });

    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.webSearchRequests).toBe(3);
    expect(event.retailer).toBe("Acme");
  });

  it("includes bodyCharacterCount only when provided", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({ callSite: "commerce_classifier", model: "m", usage: BASE_USAGE, bodyCharacterCount: 4321 });

    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.bodyCharacterCount).toBe(4321);
  });

  it("omits retailer and emailId when not provided — never emits null placeholders for inapplicable fields", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({ callSite: "email_extraction", model: "m", usage: BASE_USAGE });

    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event).not.toHaveProperty("retailer");
    expect(event).not.toHaveProperty("emailId");
    expect(event).not.toHaveProperty("bodyCharacterCount");
  });

  it("includes emailId when provided", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logAnthropicUsage({ callSite: "email_extraction", model: "m", usage: BASE_USAGE, emailId: "email_abc" });

    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.emailId).toBe("email_abc");
  });
});

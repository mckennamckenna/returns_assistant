import { vi, describe, it, expect, beforeEach } from "vitest";

// vi.hoisted ensures mockCreate is initialised before the vi.mock factory
// runs (vi.mock calls are hoisted to the top of the module by vitest's
// transform, so any variable they reference must be stable beforehand).
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

// Import AFTER the mock is registered so the module-level `anthropic`
// instance is created from our mocked class, not the real SDK.
const { isCommerceEmail } = await import("../lib/classify");

// Synthetic H&M-style HTML body: 15KB of <head>/<style> CSS filler, then
// the actual visible body text. Mirrors the real failure: html-to-text
// drops <style> content entirely, so the resolved text opens with the
// commerce signal; the old stripHtml() would have left 15KB of "a"s first.
const HM_HTML_BODY =
  "<html><head><style>" +
  "a".repeat(15_000) +
  "</style></head>" +
  "<body><div>H&amp;M Your return package has arrived. " +
  "Your refund of $29.99 will be processed within 5 business days.</div></body></html>";

function makeResponse(word: string) {
  return { content: [{ type: "text", text: word }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe("isCommerceEmail", () => {
  it("returns true for an HTML-only email whose commerce signals are past the CSS head", async () => {
    // Postmark supplies no TextBody for this email — the entire content is
    // in the 130KB HtmlBody. The old classify gate would have sliced raw
    // stripped HTML and seen only CSS filler; the fix resolves via
    // html-to-text first so the prompt starts with "H&M Your return…".
    mockCreate.mockResolvedValueOnce(makeResponse("COMMERCE"));

    const result = await isCommerceEmail(undefined, HM_HTML_BODY);

    expect(result).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();

    const calledPrompt: string = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain("H&M");
    expect(calledPrompt).not.toContain("aaaa"); // no CSS filler leaked in
  });

  it("returns false for a genuinely non-commerce email", async () => {
    const hotelTextBody =
      "Dear Guest, your hotel reservation at Marriott Downtown has been confirmed. " +
      "Check-in: June 30, 2026. Check-out: July 2, 2026. Confirmation #: 98765.";

    mockCreate.mockResolvedValueOnce(makeResponse("NOT_COMMERCE"));

    const result = await isCommerceEmail(hotelTextBody, undefined);

    expect(result).toBe(false);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("logs no email content on the COMMERCE path", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreate.mockResolvedValueOnce(makeResponse("COMMERCE"));
    await isCommerceEmail(undefined, HM_HTML_BODY);

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs no email content on the NOT_COMMERCE path", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockCreate.mockResolvedValueOnce(makeResponse("NOT_COMMERCE"));
    await isCommerceEmail("Hotel booking confirmation #98765.", undefined);

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns false without calling the API when both bodies are absent", async () => {
    const result = await isCommerceEmail(undefined, undefined);

    expect(result).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns false without calling the API when both bodies are whitespace-only", async () => {
    const result = await isCommerceEmail("   \n\t  ", "   ");

    expect(result).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

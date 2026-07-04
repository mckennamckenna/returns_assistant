import { describe, it, expect } from "vitest";
import { normalizeReturnPortalUrl, resolveReturnPortalUrlForWrite } from "../lib/extract";

// ── normalizeReturnPortalUrl ──────────────────────────────────────────────────
// Real bug: the AI sometimes extracts a bare domain/path (e.g.
// "on.com/en-us/faq/returns-and-exchanges") instead of a fully-qualified URL.
// Rendered as-is in an <a href>, the browser treats it as a relative path
// against the current origin and 404s. This is the belt-and-suspenders fix,
// called at every point returnPortalUrl enters the DB.

describe("normalizeReturnPortalUrl", () => {
  it("returns null for null", () => {
    expect(normalizeReturnPortalUrl(null)).toBe(null);
  });

  it("returns null for an empty string", () => {
    expect(normalizeReturnPortalUrl("")).toBe(null);
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizeReturnPortalUrl("   ")).toBe(null);
  });

  it("prepends https:// to a scheme-less URL", () => {
    expect(normalizeReturnPortalUrl("on.com/en-us/faq/returns-and-exchanges")).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("leaves an https:// URL unchanged", () => {
    expect(normalizeReturnPortalUrl("https://shop.mango.com/us/en/my-returns")).toBe(
      "https://shop.mango.com/us/en/my-returns",
    );
  });

  it("leaves an http:// URL unchanged", () => {
    expect(normalizeReturnPortalUrl("http://on.com/foo")).toBe("http://on.com/foo");
  });
});

// ── resolveReturnPortalUrlForWrite (extract-layer write path) ────────────────
// The exact function extractEmail() calls to produce the returnPortalUrl it
// persists — proves the write path normalizes, not just the standalone
// helper in isolation.

describe("resolveReturnPortalUrlForWrite", () => {
  it("normalizes a scheme-less URL from the email itself", () => {
    expect(resolveReturnPortalUrlForWrite("on.com/en-us/faq/returns-and-exchanges", null)).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("normalizes a scheme-less URL from the web-lookup fallback", () => {
    expect(resolveReturnPortalUrlForWrite(null, "on.com/en-us/faq/returns-and-exchanges")).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("prefers the email's own URL over the lookup's when both are present", () => {
    expect(resolveReturnPortalUrlForWrite("https://retailer.com/returns", "https://fallback.com/returns")).toBe(
      "https://retailer.com/returns",
    );
  });

  it("returns null when neither source has a URL", () => {
    expect(resolveReturnPortalUrlForWrite(null, null)).toBe(null);
  });
});

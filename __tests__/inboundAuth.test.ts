import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
});

const { isInboundWebhookAuthorized } = await import("../app/api/inbound/route");

function basicAuthHeader(user: string, password: string, scheme = "Basic"): string {
  return `${scheme} ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("isInboundWebhookAuthorized", () => {
  it("is dormant (lets everything through) when both env vars are unset", () => {
    expect(isInboundWebhookAuthorized(null)).toBe(true);
    expect(isInboundWebhookAuthorized("garbage")).toBe(true);
  });

  it("is dormant when only one env var is set", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "");
    expect(isInboundWebhookAuthorized(null)).toBe(true);
  });

  it("accepts correct credentials once both env vars are set", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "s3cret"))).toBe(true);
  });

  it("accepts a case-insensitive Basic scheme", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "s3cret", "basic"))).toBe(true);
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "s3cret", "BASIC"))).toBe(true);
  });

  it("rejects a missing Authorization header once configured", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(null)).toBe(false);
  });

  it("rejects the wrong password", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "wrong"))).toBe(false);
  });

  it("rejects the wrong username", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(basicAuthHeader("wrong", "s3cret"))).toBe(false);
  });

  it("rejects a non-Basic scheme", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized(`Bearer ${Buffer.from("postmark:s3cret").toString("base64")}`)).toBe(false);
  });

  it("rejects malformed base64 in the credentials", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3cret");
    expect(isInboundWebhookAuthorized("Basic not-valid-base64!!!")).toBe(false);
  });

  it("handles a password containing a colon correctly", () => {
    vi.stubEnv("INBOUND_WEBHOOK_USER", "postmark");
    vi.stubEnv("INBOUND_WEBHOOK_PASSWORD", "s3:cret");
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "s3:cret"))).toBe(true);
    expect(isInboundWebhookAuthorized(basicAuthHeader("postmark", "wrong:pass"))).toBe(false);
  });
});

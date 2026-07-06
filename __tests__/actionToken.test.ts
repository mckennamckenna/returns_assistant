import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SECRET = "a".repeat(64); // 32 bytes hex-encoded

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
});

const { signToken, verifyToken, validateTokenSigningSecret, ACTION_TOKEN_TTL_DAYS } =
  await import("../lib/actionToken");

describe("signToken / verifyToken round trip", () => {
  it("verifies a freshly signed token for the matching action and orderId", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const result = verifyToken(token, { action: "archive", orderId: "order_1" });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
      expect(result.payload.action).toBe("archive");
    }
  });

  it("rejects a token when the expected action doesn't match (scoped to one action)", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const result = verifyToken(token, { action: "refunded", orderId: "order_1" });

    expect(result.valid).toBe(false);
  });

  it("rejects a token when the expected orderId doesn't match (scoped to one order)", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const result = verifyToken(token, { action: "archive", orderId: "order_2" });

    expect(result.valid).toBe(false);
  });

  it("rejects a token with a tampered payload", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const [, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ orderId: "order_2", userId: "user_1", action: "archive", issuedAt: Date.now() }),
    ).toString("base64url");

    const result = verifyToken(`${tamperedPayload}.${signature}`, { action: "archive", orderId: "order_2" });
    expect(result.valid).toBe(false);
  });

  it("rejects a token with a tampered signature (same length, different bytes)", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const [payload, signature] = token.split(".");
    const flippedChar = signature[0] === "A" ? "B" : "A";
    const tamperedSignature = flippedChar + signature.slice(1);

    const result = verifyToken(`${payload}.${tamperedSignature}`, { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(false);
  });

  it("rejects a token with a truncated signature (length-guard path, distinct from constant-time comparison)", () => {
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });
    const [payload, signature] = token.split(".");
    const truncatedSignature = signature.slice(0, -1);

    const result = verifyToken(`${payload}.${truncatedSignature}`, { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(false);
  });

  it("rejects an expired token (issued more than ACTION_TOKEN_TTL_DAYS ago)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });

    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + (ACTION_TOKEN_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    const result = verifyToken(token, { action: "archive", orderId: "order_1" });
    vi.useRealTimers();

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });

  it("accepts a token issued just under ACTION_TOKEN_TTL_DAYS ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = signToken({ orderId: "order_1", userId: "user_1", action: "archive" });

    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + (ACTION_TOKEN_TTL_DAYS - 1) * 24 * 60 * 60 * 1000);
    const result = verifyToken(token, { action: "archive", orderId: "order_1" });
    vi.useRealTimers();

    expect(result.valid).toBe(true);
  });

  it("rejects a malformed token with no '.' separator, without throwing", () => {
    expect(() => verifyToken("not-a-real-token", { action: "archive", orderId: "order_1" })).not.toThrow();
    const result = verifyToken("not-a-real-token", { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(false);
  });

  it("rejects a token with invalid base64 in the payload segment, without throwing", () => {
    const result = verifyToken("!!!not-base64!!!.somesignature", { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(false);
  });

  it("rejects a token whose decoded payload isn't valid JSON, without throwing", () => {
    const badPayload = Buffer.from("not json", "utf8").toString("base64url");
    const result = verifyToken(`${badPayload}.somesignature`, { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(false);
  });
});

describe("validateTokenSigningSecret", () => {
  it("throws when the secret is undefined", () => {
    expect(() => validateTokenSigningSecret(undefined)).toThrow();
  });

  it("throws when the secret is an empty string", () => {
    expect(() => validateTokenSigningSecret("")).toThrow();
  });

  it("throws when the decoded secret is shorter than 32 bytes (31 bytes)", () => {
    expect(() => validateTokenSigningSecret("a".repeat(62))).toThrow(); // 31 bytes hex-encoded
  });

  it("does not throw when the decoded secret is exactly 32 bytes", () => {
    expect(() => validateTokenSigningSecret("a".repeat(64))).not.toThrow();
  });

  it("does not throw when the decoded secret is longer than 32 bytes", () => {
    expect(() => validateTokenSigningSecret("a".repeat(96))).not.toThrow();
  });
});

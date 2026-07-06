import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
});

const { buildActionLink } = await import("../lib/actionLinks");
const { verifyToken } = await import("../lib/actionToken");

describe("buildActionLink", () => {
  it("builds a URL pointing at /action/{action} on the production app domain", () => {
    const link = buildActionLink({ orderId: "order_1", userId: "user_1", action: "archive" });
    expect(link.startsWith("https://app.myreturnwindow.com/action/archive?token=")).toBe(true);
  });

  it("embeds a token that verifies for the same action and orderId", () => {
    const link = buildActionLink({ orderId: "order_1", userId: "user_1", action: "archive" });
    const token = decodeURIComponent(new URL(link).searchParams.get("token")!);

    const result = verifyToken(token, { action: "archive", orderId: "order_1" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("produces a different path for a different action", () => {
    const link = buildActionLink({ orderId: "order_1", userId: "user_1", action: "returned" });
    expect(link.startsWith("https://app.myreturnwindow.com/action/returned?token=")).toBe(true);
  });
});

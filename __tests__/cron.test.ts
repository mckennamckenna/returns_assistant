import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
});

const { buildBody } = await import("../app/api/cron/route");
const { verifyToken } = await import("../lib/actionToken");

describe("reminder email buildBody — Archive link (Phase 5)", () => {
  it("includes an Archive link that verifies for this order's id and userId", () => {
    const body = buildBody(
      {
        id: "order_1",
        retailer: "H&M",
        orderNumber: "123",
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        userId: "user_1",
      },
      "2_day",
    );

    expect(body).toContain("Archive this order (stops all reminders): https://app.myreturnwindow.com/action/archive?token=");

    const match = body.match(/action\/archive\?token=([^\s]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const result = verifyToken(token, { action: "archive" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("still includes the existing 'View details' dashboard link alongside the Archive link", () => {
    const body = buildBody(
      {
        id: "order_1",
        retailer: "H&M",
        orderNumber: null,
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: null,
        orderCurrency: null,
        userId: "user_1",
      },
      "same_day",
    );

    expect(body).toContain("View details: https://app.myreturnwindow.com/orders/order_1");
  });
});

describe("reminder email buildBody — Mark as returned link", () => {
  it("includes a Mark-as-returned link that verifies for this order's id and userId", () => {
    const body = buildBody(
      {
        id: "order_1",
        retailer: "H&M",
        orderNumber: "123",
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        userId: "user_1",
      },
      "2_day",
    );

    expect(body).toContain("Already shipped it back? Mark as returned: https://app.myreturnwindow.com/action/returned?token=");

    const match = body.match(/action\/returned\?token=([^\s]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const result = verifyToken(token, { action: "returned" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("includes both the Mark-as-returned link and the Archive link, each with its own action-scoped token", () => {
    const body = buildBody(
      {
        id: "order_1",
        retailer: "H&M",
        orderNumber: "123",
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        userId: "user_1",
      },
      "2_day",
    );

    const returnedMatch = body.match(/action\/returned\?token=([^\s]+)/);
    const archiveMatch = body.match(/action\/archive\?token=([^\s]+)/);
    expect(returnedMatch).not.toBeNull();
    expect(archiveMatch).not.toBeNull();

    const returnedResult = verifyToken(decodeURIComponent(returnedMatch![1]), { action: "returned" });
    const archiveResult = verifyToken(decodeURIComponent(archiveMatch![1]), { action: "archive" });
    expect(returnedResult.valid).toBe(true);
    expect(archiveResult.valid).toBe(true);

    // A returned-action token must never verify as a valid archive token,
    // and vice versa — action is part of what's signed, not just routing.
    expect(verifyToken(decodeURIComponent(returnedMatch![1]), { action: "archive" }).valid).toBe(false);
  });
});

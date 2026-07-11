import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
});

const { buildBody, buildOrderLine } = await import("../app/api/cron/weekly-digest/route");
const { verifyToken } = await import("../lib/actionToken");

const ORDER = {
  id: "order_1",
  retailer: "H&M",
  orderNumber: "123",
  returnDeadline: new Date("2026-07-20T00:00:00Z"),
  displayStatus: "shipped",
};

describe("weekly digest buildOrderLine / buildBody — Archive link (Phase 5)", () => {
  it("buildOrderLine includes an Archive link that verifies for this order's id and userId", () => {
    const line = buildOrderLine(ORDER, new Date("2026-07-13T00:00:00Z"), "user_1");

    expect(line).toContain("Archive this order (stops all reminders): https://app.myreturnwindow.com/action/archive?token=");

    const match = line.match(/action\/archive\?token=([^\s]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const result = verifyToken(token, { action: "archive" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("buildBody threads userId through to each order's Archive link", () => {
    const body = buildBody([ORDER], new Date("2026-07-13T00:00:00Z"), "user_1");
    const match = body.match(/action\/archive\?token=([^\s]+)/);
    expect(match).not.toBeNull();

    const token = decodeURIComponent(match![1]);
    const result = verifyToken(token, { action: "archive" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.userId).toBe("user_1");
  });

  it("the zero-orders fallback body has no Archive link (nothing to archive)", () => {
    const body = buildBody([], new Date("2026-07-13T00:00:00Z"), "user_1");
    expect(body).not.toContain("action/archive");
    expect(body).toContain("Nothing due this week");
  });
});

describe("weekly digest buildOrderLine / buildBody — Mark as returned link", () => {
  it("buildOrderLine includes a Mark-as-returned link that verifies for this order's id and userId", () => {
    const line = buildOrderLine(ORDER, new Date("2026-07-13T00:00:00Z"), "user_1");

    expect(line).toContain("Already shipped it back? Mark as returned: https://app.myreturnwindow.com/action/returned?token=");

    const match = line.match(/action\/returned\?token=([^\s]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);

    const result = verifyToken(token, { action: "returned" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("buildBody threads userId through to each order's Mark-as-returned link", () => {
    const body = buildBody([ORDER], new Date("2026-07-13T00:00:00Z"), "user_1");
    const match = body.match(/action\/returned\?token=([^\s]+)/);
    expect(match).not.toBeNull();

    const token = decodeURIComponent(match![1]);
    const result = verifyToken(token, { action: "returned" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.userId).toBe("user_1");
  });

  it("the zero-orders fallback body has no Mark-as-returned link (nothing to mark)", () => {
    const body = buildBody([], new Date("2026-07-13T00:00:00Z"), "user_1");
    expect(body).not.toContain("action/returned");
    expect(body).toContain("Nothing due this week");
  });
});

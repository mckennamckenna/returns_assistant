import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
});

const { buildBody, buildHtmlBody } = await import("../app/api/cron/route");
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

describe("reminder email buildHtmlBody — real links, no visible raw URLs", () => {
  const ORDER = {
    id: "order_1",
    retailer: "H&M",
    orderNumber: "123",
    returnDeadline: new Date("2026-07-20T00:00:00Z"),
    deadlineIsEstimated: false,
    orderTotal: 45,
    orderCurrency: "USD",
    userId: "user_1",
  };

  it("renders all three links as real <a> tags with the exact requested short copy", () => {
    const html = buildHtmlBody(ORDER, "2_day");

    expect(html).toContain('<a href="https://app.myreturnwindow.com/orders/order_1"');
    expect(html).toContain(">View order details</a>");

    expect(html).toMatch(/<a href="https:\/\/app\.myreturnwindow\.com\/action\/returned\?token=[^"]+"/);
    expect(html).toContain("Already shipped it back? Mark as returned →</a>");

    expect(html).toMatch(/<a href="https:\/\/app\.myreturnwindow\.com\/action\/archive\?token=[^"]+"/);
    expect(html).toContain(">Archive this order</a>");
  });

  it("the returned/archive links in the HTML body verify with real, action-scoped tokens", () => {
    const html = buildHtmlBody(ORDER, "2_day");

    const returnedMatch = html.match(/action\/returned\?token=([^"]+)/);
    const archiveMatch = html.match(/action\/archive\?token=([^"]+)/);
    expect(returnedMatch).not.toBeNull();
    expect(archiveMatch).not.toBeNull();

    expect(verifyToken(returnedMatch![1], { action: "returned" }).valid).toBe(true);
    expect(verifyToken(archiveMatch![1], { action: "archive" }).valid).toBe(true);
  });

  it("escapes an HTML-unsafe retailer name instead of breaking the markup", () => {
    const html = buildHtmlBody({ ...ORDER, retailer: `Sam's <Club> & Co` }, "2_day");
    expect(html).toContain("Sam&#39;s &lt;Club&gt; &amp; Co");
    expect(html).not.toContain("Sam's <Club> & Co");
  });

  it("includes the estimated-deadline caveat when deadlineIsEstimated is true", () => {
    const html = buildHtmlBody({ ...ORDER, deadlineIsEstimated: true }, "2_day");
    expect(html).toContain("Deadline based on shipping estimate");
  });

  it("omits the order-total line when orderTotal is null", () => {
    const html = buildHtmlBody({ ...ORDER, orderTotal: null, orderCurrency: null }, "2_day");
    expect(html).not.toContain("Order total:");
  });
});

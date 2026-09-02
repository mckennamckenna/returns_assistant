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
        orderDate: new Date("2026-07-01T00:00:00Z"),
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        returnPortalUrl: "https://hm.com/returns",
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
        orderDate: null,
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: null,
        orderCurrency: null,
        returnPortalUrl: null,
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
        orderDate: new Date("2026-07-01T00:00:00Z"),
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        returnPortalUrl: "https://hm.com/returns",
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
        orderDate: new Date("2026-07-01T00:00:00Z"),
        returnDeadline: new Date("2026-07-20T00:00:00Z"),
        deadlineIsEstimated: false,
        orderTotal: 45,
        orderCurrency: "USD",
        returnPortalUrl: "https://hm.com/returns",
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

describe("reminder email buildBody — orderDate, orderNumber, and Start return line (TASKS.md 2026-09-01)", () => {
  const BASE = {
    id: "order_1",
    retailer: "H&M",
    orderNumber: "123",
    orderDate: new Date("2026-07-01T00:00:00Z"),
    returnDeadline: new Date("2026-07-20T00:00:00Z"),
    deadlineIsEstimated: false,
    orderTotal: 45,
    orderCurrency: "USD",
    returnPortalUrl: "https://hm.com/returns",
    userId: "user_1",
  };

  it("renders orderDate on its own line", () => {
    const body = buildBody(BASE, "2_day");
    expect(body).toContain("Order date: Jul 1, 2026");
  });

  it("omits the order date line when orderDate is null", () => {
    const body = buildBody({ ...BASE, orderDate: null }, "2_day");
    expect(body).not.toContain("Order date:");
  });

  it("renders orderNumber on its own line, truncated the same way the dashboard displays it", () => {
    const body = buildBody({ ...BASE, orderNumber: "6a4d94320430dfcddda3748a" }, "2_day");
    expect(body).toContain("Order number: 6a4d94…748a");
  });

  it("omits the order number line when orderNumber is null", () => {
    const body = buildBody({ ...BASE, orderNumber: null }, "2_day");
    expect(body).not.toContain("Order number:");
  });

  it("includes a Start-return link that verifies for the start-return action when returnPortalUrl is present", () => {
    const body = buildBody(BASE, "2_day");
    expect(body).toContain("Start a return at H&M: https://app.myreturnwindow.com/action/start-return?token=");

    const match = body.match(/action\/start-return\?token=([^\s]+)/);
    expect(match).not.toBeNull();
    const result = verifyToken(decodeURIComponent(match![1]), { action: "start-return" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.orderId).toBe("order_1");
      expect(result.payload.userId).toBe("user_1");
    }
  });

  it("omits the Start-return line entirely when returnPortalUrl is null — no dead link", () => {
    const body = buildBody({ ...BASE, returnPortalUrl: null }, "2_day");
    expect(body).not.toContain("Start a return");
    expect(body).not.toContain("action/start-return");
  });
});

describe("reminder email buildHtmlBody — real links, no visible raw URLs", () => {
  const ORDER = {
    id: "order_1",
    retailer: "H&M",
    orderNumber: "123",
    orderDate: new Date("2026-07-01T00:00:00Z"),
    returnDeadline: new Date("2026-07-20T00:00:00Z"),
    deadlineIsEstimated: false,
    orderTotal: 45,
    orderCurrency: "USD",
    returnPortalUrl: "https://hm.com/returns",
    userId: "user_1",
  };

  it("renders all four links/buttons as real <a> tags with the exact requested short copy", () => {
    const html = buildHtmlBody(ORDER, "2_day");

    expect(html).toContain('<a href="https://app.myreturnwindow.com/orders/order_1"');
    expect(html).toContain(">View order details</a>");

    expect(html).toMatch(/<a href="https:\/\/app\.myreturnwindow\.com\/action\/returned\?token=[^"]+"/);
    expect(html).toContain("Already shipped it back? Mark as returned →</a>");

    expect(html).toMatch(/<a href="https:\/\/app\.myreturnwindow\.com\/action\/archive\?token=[^"]+"/);
    expect(html).toContain(">Archive this order</a>");

    expect(html).toMatch(/<a href="https:\/\/app\.myreturnwindow\.com\/action\/start-return\?token=[^"]+"/);
    expect(html).toContain("Start return →</a>");
  });

  it("the returned/archive/start-return links in the HTML body verify with real, action-scoped tokens", () => {
    const html = buildHtmlBody(ORDER, "2_day");

    const returnedMatch = html.match(/action\/returned\?token=([^"]+)/);
    const archiveMatch = html.match(/action\/archive\?token=([^"]+)/);
    const startReturnMatch = html.match(/action\/start-return\?token=([^"]+)/);
    expect(returnedMatch).not.toBeNull();
    expect(archiveMatch).not.toBeNull();
    expect(startReturnMatch).not.toBeNull();

    expect(verifyToken(returnedMatch![1], { action: "returned" }).valid).toBe(true);
    expect(verifyToken(archiveMatch![1], { action: "archive" }).valid).toBe(true);
    expect(verifyToken(startReturnMatch![1], { action: "start-return" }).valid).toBe(true);
  });

  it("omits the Start-return button entirely when returnPortalUrl is null — no dead link, no 'coming soon'", () => {
    const html = buildHtmlBody({ ...ORDER, returnPortalUrl: null }, "2_day");
    expect(html).not.toContain("Start return");
    expect(html).not.toContain("action/start-return");
  });

  it("renders orderDate and a monospace, selectable orderNumber block", () => {
    const html = buildHtmlBody(ORDER, "2_day");
    expect(html).toContain("Order date: Jul 1, 2026");
    expect(html).toContain("Order number");
    expect(html).toContain("<code");
    expect(html).toContain("123");
  });

  it("omits the order date and order number blocks when null", () => {
    const html = buildHtmlBody({ ...ORDER, orderDate: null, orderNumber: null }, "2_day");
    expect(html).not.toContain("Order date:");
    expect(html).not.toContain("<code");
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

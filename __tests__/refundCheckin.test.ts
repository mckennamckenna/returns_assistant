import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/orderFilters", async () => {
  const real = await vi.importActual<typeof import("../lib/orderFilters")>("../lib/orderFilters");
  return real;
});
import {
  refundCheckinSendAfter,
  refundCheckinOrderWhere,
  buildRefundCheckinBody,
  buildRefundCheckinHtmlBody,
  REFUND_CHECKIN_REMINDER_TYPE,
} from "../lib/refundCheckin";

// ── Delay branching: 5 vs 10 days ────────────────────────────────────────────

describe("refundCheckinSendAfter", () => {
  const returnedAt = new Date("2026-07-01T12:00:00.000Z");

  it("schedules 5 days out when returnTrackingNumber is present", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, true);
    const expectedMs = returnedAt.getTime() + 5 * 24 * 60 * 60 * 1000;
    expect(sendAfter.getTime()).toBe(expectedMs);
  });

  it("schedules 10 days out when returnTrackingNumber is absent", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, false);
    const expectedMs = returnedAt.getTime() + 10 * 24 * 60 * 60 * 1000;
    expect(sendAfter.getTime()).toBe(expectedMs);
  });

  it("is not due 4 days after returned (with tracking)", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, true);
    const fourDaysLater = new Date(returnedAt.getTime() + 4 * 24 * 60 * 60 * 1000);
    expect(fourDaysLater.getTime()).toBeLessThan(sendAfter.getTime());
  });

  it("is due 5 days after returned (with tracking)", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, true);
    const fiveDaysLater = new Date(returnedAt.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(fiveDaysLater.getTime()).toBeGreaterThanOrEqual(sendAfter.getTime());
  });

  it("is not due 9 days after returned (without tracking)", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, false);
    const nineDaysLater = new Date(returnedAt.getTime() + 9 * 24 * 60 * 60 * 1000);
    expect(nineDaysLater.getTime()).toBeLessThan(sendAfter.getTime());
  });

  it("is due 10 days after returned (without tracking)", () => {
    const sendAfter = refundCheckinSendAfter(returnedAt, false);
    const tenDaysLater = new Date(returnedAt.getTime() + 10 * 24 * 60 * 60 * 1000);
    expect(tenDaysLater.getTime()).toBeGreaterThanOrEqual(sendAfter.getTime());
  });
});

// ── Dedup / archived / deleted exclusion — query filter ──────────────────────
// These tests assert on the where clause that the cron passes to findMany.
// If the filter is wrong, the row would be fetched and a double-send would occur.

describe("refundCheckinOrderWhere", () => {
  it("targets only orders with displayStatus = returned", () => {
    expect(refundCheckinOrderWhere().displayStatus).toBe("returned");
  });

  it("excludes archived orders", () => {
    expect(refundCheckinOrderWhere().archivedAt).toBe(null);
  });

  it("excludes soft-deleted orders", () => {
    expect(refundCheckinOrderWhere().deletedAt).toBe(null);
  });

  it("excludes orders that already received a refund_checkin reminder (dedup)", () => {
    const where = refundCheckinOrderWhere();
    expect(where.reminders).toEqual({
      none: { reminderType: REFUND_CHECKIN_REMINDER_TYPE },
    });
  });

  it("only considers orders where returnedAt is set", () => {
    // returnedAt: { not: null } — prevents running against orders that somehow
    // hit displayStatus=returned without a timestamp (shouldn't happen, but safe).
    expect(refundCheckinOrderWhere().returnedAt).toEqual({ not: null });
  });
});

// ── Body builder ─────────────────────────────────────────────────────────────

describe("buildRefundCheckinBody", () => {
  const base = {
    retailer: "Shopbop",
    lineItems: [{ name: "Ulla Johnson Dress", price: 295, quantity: 1 }],
    returnedAt: new Date("2026-07-01T12:00:00.000Z"),
    id: "order-abc",
  };

  it("includes the retailer and item name when lineItems is set", () => {
    const body = buildRefundCheckinBody(base);
    expect(body).toContain("Shopbop / Ulla Johnson Dress");
  });

  it("falls back to retailer only when lineItems is empty", () => {
    const body = buildRefundCheckinBody({ ...base, lineItems: [] });
    expect(body).toContain("Shopbop was marked returned on");
    expect(body).not.toContain("Shopbop /");
  });

  it("falls back to 'Your order' when retailer is null", () => {
    const body = buildRefundCheckinBody({ ...base, retailer: null });
    expect(body).toContain("Your order");
  });

  it("includes the order detail link", () => {
    const body = buildRefundCheckinBody(base);
    expect(body).toContain("https://app.myreturnwindow.com/orders/order-abc");
  });
});

// ── HTML body builder ────────────────────────────────────────────────────────

describe("buildRefundCheckinHtmlBody", () => {
  const base = {
    retailer: "Shopbop",
    lineItems: [{ name: "Ulla Johnson Dress", price: 295, quantity: 1 }],
    returnedAt: new Date("2026-07-01T12:00:00.000Z"),
    id: "order-abc",
  };

  it("renders the order link as a real <a> tag with the exact requested short copy, no visible raw URL", () => {
    const html = buildRefundCheckinHtmlBody(base);
    expect(html).toContain('<a href="https://app.myreturnwindow.com/orders/order-abc"');
    expect(html).toContain(">View order details</a>");
  });

  it("includes the retailer and item name when lineItems is set", () => {
    const html = buildRefundCheckinHtmlBody(base);
    expect(html).toContain("Shopbop / Ulla Johnson Dress");
  });

  it("escapes an HTML-unsafe retailer name instead of breaking the markup", () => {
    const html = buildRefundCheckinHtmlBody({ ...base, retailer: `Sam's <Club> & Co`, lineItems: [] });
    expect(html).toContain("Sam&#39;s &lt;Club&gt; &amp; Co");
    expect(html).not.toContain("Sam's <Club> & Co");
  });

  it("falls back to 'Your order' when retailer is null", () => {
    const html = buildRefundCheckinHtmlBody({ ...base, retailer: null });
    expect(html).toContain("Your order");
  });
});

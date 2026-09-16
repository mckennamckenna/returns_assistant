import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Pure-function smoke coverage for the alpha weekly-url-review job's
// scoring heuristics and search-subject priority order, plus one
// directed route-level test for the DB-before-Sheet write ordering
// (2026-09-11 ghost-Sheet-row fix) below. Full-route behavior beyond
// that (auth, notifyAdmin summary shape, etc.) is not exercised here —
// this is alpha infra, smoke coverage only, per the build spec's
// non-goals.

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    returnUrlReview: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/search", () => ({ searchWeb: vi.fn() }));
vi.mock("@/lib/sheets", () => ({
  ensureSheetHeaders: vi.fn().mockResolvedValue(undefined),
  appendReviewRow: vi.fn(),
}));

import { scoreResult, resolveSearchSubject, stripTrackingParams, GET } from "@/app/api/cron/weekly-url-review/route";
import { searchWeb } from "@/lib/search";
import { appendReviewRow } from "@/lib/sheets";

const APP_DOMAIN = "myreturnwindow.com";

describe("scoreResult", () => {
  it("rewards a URL matching the retailer's own known domain", () => {
    const score = scoreResult({ title: "", url: "https://mango.com/returns", snippet: "" }, "mango.com", APP_DOMAIN);
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it("rewards return/returns in the path", () => {
    const score = scoreResult({ title: "", url: "https://example.com/returns/start", snippet: "" }, null, APP_DOMAIN);
    expect(score).toBeGreaterThan(0);
  });

  it("penalizes contact/help/support/track/login/account paths", () => {
    for (const bad of ["contact", "help", "support", "track", "login", "signin", "account"]) {
      const score = scoreResult({ title: "", url: `https://example.com/${bad}`, snippet: "" }, null, APP_DOMAIN);
      expect(score).toBeLessThan(0);
    }
  });

  it("penalizes known shipping-carrier domains", () => {
    const score = scoreResult({ title: "", url: "https://www.fedex.com/track", snippet: "" }, null, APP_DOMAIN);
    expect(score).toBeLessThan(0);
  });

  it("penalizes known aggregator/forum/review domains even with a return-y path", () => {
    const score = scoreResult(
      { title: "", url: "https://www.reddit.com/r/target/comments/xyz/how_do_i_return", snippet: "" },
      null,
      APP_DOMAIN,
    );
    expect(score).toBeLessThan(0);
  });

  it("heavily penalizes our own app domain (self-domain loop)", () => {
    const score = scoreResult(
      { title: "", url: "https://app.myreturnwindow.com/orders/123", snippet: "" },
      null,
      APP_DOMAIN,
    );
    expect(score).toBeLessThanOrEqual(-10);
  });
});

describe("resolveSearchSubject", () => {
  it("priority (1): uses a previously-approved retailer name for the same normalized retailer", () => {
    const approvals = new Map([["oak valley", "Oak Valley Designs"]]);
    const result = resolveSearchSubject(
      { retailer: "Oak Valley", returnPortalUrl: null },
      approvals,
      APP_DOMAIN,
    );
    expect(result.searchAnchor).toBe("Oak Valley Designs");
    expect(result.retailerPrefill).toBe("Oak Valley Designs");
  });

  it("priority (2): prefers an existing returnPortalUrl's domain when it looks like a real retailer domain — searchAnchor only, retailerPrefill stays name-only", () => {
    const result = resolveSearchSubject(
      { retailer: "Mango", returnPortalUrl: "https://www.mango.com/us/help/returns" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.searchAnchor).toBe("mango.com");
    expect(result.knownDomain).toBe("mango.com");
    // retailerPrefill mirrors raw order.retailer (matches rawRetailer's own
    // casing), not searchAnchor's domain and not normalizeRetailer's
    // lowercased form.
    expect(result.retailerPrefill).toBe("Mango");
  });

  it("priority (2) is skipped when the existing URL is a carrier domain", () => {
    const result = resolveSearchSubject(
      { retailer: "Some Retailer", returnPortalUrl: "https://www.fedex.com/track" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.searchAnchor).toBe("some retailer");
  });

  it("priority (2) is skipped when the existing URL is our own domain (self-domain loop)", () => {
    const result = resolveSearchSubject(
      { retailer: "Some Retailer", returnPortalUrl: "https://app.myreturnwindow.com/orders/1" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.searchAnchor).toBe("some retailer");
  });

  it("priority (3): searchAnchor falls back to passive-normalized Order.retailer; retailerPrefill uses the raw value", () => {
    const result = resolveSearchSubject({ retailer: "Gap Inc.", returnPortalUrl: null }, new Map(), APP_DOMAIN);
    expect(result.searchAnchor).toBe("gap");
    expect(result.knownDomain).toBeNull();
    expect(result.retailerPrefill).toBe("Gap Inc.");
  });

  // T1 (2026-09-16 fix, corrected same day — see commit after d1e0711) —
  // the bug this session fixes: an order whose returnPortalUrl domain is a
  // legitimate search anchor must NOT leak that domain into the
  // human-facing Approved-retailer prefill. retailerPrefill uses the raw
  // order.retailer (not normalizeRetailer's lowercased form) so it matches
  // rawRetailer's own casing in the sheet.
  it("2026-09-16 fix: searchAnchor uses the returnPortalUrl domain, retailerPrefill stays the retailer name (title case, matching Raw retailer), not the domain", () => {
    const result = resolveSearchSubject(
      { retailer: "Nordstrom", returnPortalUrl: "https://click.eml.nordstrom.com/?id=123" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.searchAnchor).toBe("click.eml.nordstrom.com");
    expect(result.retailerPrefill).toBe("Nordstrom");
    expect(result.retailerPrefill).not.toMatch(/\./);
  });

  // T2 (2026-09-16 fix) — self-perpetuation-loop defense: a historical
  // approval that was itself URL-shaped (the exact poisoning mechanism —
  // one bad approval feeds every future row for the same retailer) must
  // not be reused as a name prefill, even though it's still fine as a
  // search anchor.
  it("2026-09-16 fix: a URL-shaped prior approval is rejected as retailerPrefill but still used as searchAnchor", () => {
    const approvals = new Map([["shopbop", "shopbop.com"]]);
    const result = resolveSearchSubject({ retailer: "Shopbop", returnPortalUrl: null }, approvals, APP_DOMAIN);
    expect(result.searchAnchor).toBe("shopbop.com");
    expect(result.retailerPrefill).toBe("Shopbop");
    expect(result.retailerPrefill).not.toBe("shopbop.com");
  });
});

describe("stripTrackingParams", () => {
  it("strips every listed tracking param", () => {
    const url =
      "https://example.com/returns?srsltid=abc&utm_source=x&utm_medium=y&utm_campaign=z&utm_term=t&utm_content=c" +
      "&cid=1&gclid=2&fbclid=3&mc_cid=4&mc_eid=5&_ga=6&_gl=7&ref=8&ref_src=9";
    expect(stripTrackingParams(url)).toBe("https://example.com/returns");
  });

  it("leaves unlisted query params untouched", () => {
    const url = "https://example.com/returns?locale=us&srsltid=abc";
    expect(stripTrackingParams(url)).toBe("https://example.com/returns?locale=us");
  });

  it("leaves a URL with no query string untouched", () => {
    const url = "https://example.com/returns";
    expect(stripTrackingParams(url)).toBe(url);
  });

  it("returns an empty string unchanged", () => {
    expect(stripTrackingParams("")).toBe("");
  });

  it("returns an unparseable URL unchanged rather than throwing", () => {
    expect(stripTrackingParams("not a url")).toBe("not a url");
  });
});

describe("GET (write ordering)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    process.env.APP_DOMAIN = APP_DOMAIN;
    mockPrisma.returnUrlReview.findMany.mockResolvedValue([]);
    mockPrisma.order.findMany.mockResolvedValue([
      { id: "order-1", retailer: "Some Retailer", returnPortalUrl: null },
    ]);
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Returns", url: "https://someretailer.com/returns", snippet: "" },
    ]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeRequest() {
    return new NextRequest("https://example.com/api/cron/weekly-url-review?secret=test-secret");
  }

  // 2026-09-11 ghost-Sheet-row fix: under concurrent invocations, the old
  // write order (Sheet append, then DB create) let a losing invocation's
  // DB create fail on the orderId unique constraint AFTER it had already
  // written a Sheet row for that order — a ghost row with no DB record
  // behind it. DB-create-first means a losing invocation never reaches
  // appendReviewRow() at all.
  it("does not call appendReviewRow when the DB write fails", async () => {
    mockPrisma.returnUrlReview.create.mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`orderId`)"),
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(mockPrisma.returnUrlReview.create).toHaveBeenCalled();
    expect(appendReviewRow).not.toHaveBeenCalled();
    expect(body.queued).toEqual([]);
    expect(body.failed).toEqual([
      {
        orderId: "order-1",
        retailer: "Some Retailer",
        error: "Unique constraint failed on the fields: (`orderId`)",
      },
    ]);
  });

  it("calls appendReviewRow and attaches sheetRowId after a successful DB write", async () => {
    mockPrisma.returnUrlReview.create.mockResolvedValue({});
    vi.mocked(appendReviewRow).mockResolvedValue("7");
    mockPrisma.returnUrlReview.update.mockResolvedValue({});

    const response = await GET(makeRequest());
    const body = await response.json();

    const createOrder = mockPrisma.returnUrlReview.create.mock.invocationCallOrder[0];
    const appendOrder = vi.mocked(appendReviewRow).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(appendOrder);
    expect(mockPrisma.returnUrlReview.update).toHaveBeenCalledWith({
      where: { orderId: "order-1" },
      data: { sheetRowId: "7" },
    });
    expect(body.queued).toEqual([{ orderId: "order-1", retailer: "Some Retailer", candidateUrl: "https://someretailer.com/returns" }]);
  });
});

import { vi, describe, it, expect } from "vitest";

// Pure-function smoke coverage for the alpha weekly-url-review job's
// scoring heuristics and search-subject priority order. Full-route
// behavior (auth, per-order try/catch, self-healing on failure) is not
// exercised here — this is alpha infra, smoke coverage only, per the
// build spec's non-goals.

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/search", () => ({ searchWeb: vi.fn() }));
vi.mock("@/lib/sheets", () => ({ ensureSheetHeaders: vi.fn(), appendReviewRow: vi.fn() }));

import { scoreResult, resolveSearchSubject } from "@/app/api/cron/weekly-url-review/route";

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
    expect(result.subject).toBe("Oak Valley Designs");
  });

  it("priority (2): prefers an existing returnPortalUrl's domain when it looks like a real retailer domain", () => {
    const result = resolveSearchSubject(
      { retailer: "Mango", returnPortalUrl: "https://www.mango.com/us/help/returns" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.subject).toBe("mango.com");
    expect(result.knownDomain).toBe("mango.com");
  });

  it("priority (2) is skipped when the existing URL is a carrier domain", () => {
    const result = resolveSearchSubject(
      { retailer: "Some Retailer", returnPortalUrl: "https://www.fedex.com/track" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.subject).toBe("some retailer");
  });

  it("priority (2) is skipped when the existing URL is our own domain (self-domain loop)", () => {
    const result = resolveSearchSubject(
      { retailer: "Some Retailer", returnPortalUrl: "https://app.myreturnwindow.com/orders/1" },
      new Map(),
      APP_DOMAIN,
    );
    expect(result.subject).toBe("some retailer");
  });

  it("priority (3): falls back to passive-normalized Order.retailer", () => {
    const result = resolveSearchSubject({ retailer: "Gap Inc.", returnPortalUrl: null }, new Map(), APP_DOMAIN);
    expect(result.subject).toBe("gap");
    expect(result.knownDomain).toBeNull();
  });
});

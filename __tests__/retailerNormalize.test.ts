import { describe, it, expect } from "vitest";
import { normalizeRetailer, isMeaningfulRetailerChange, isUrlShapedRetailer } from "@/lib/retailer-normalize";

describe("normalizeRetailer", () => {
  it("lowercases and trims", () => {
    expect(normalizeRetailer("  Gap  ")).toBe("gap");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeRetailer("Buff   City  Soap")).toBe("buff city soap");
  });

  it("strips trailing punctuation — the DONNI/DONNI. case from the 2026-08-13 cache-sizing investigation", () => {
    expect(normalizeRetailer("DONNI")).toBe(normalizeRetailer("DONNI."));
    expect(normalizeRetailer("DONNI.")).toBe("donni");
  });

  it("strips common legal/store suffixes", () => {
    expect(normalizeRetailer("Gap Inc.")).toBe("gap");
    expect(normalizeRetailer("Gap Inc")).toBe("gap");
    expect(normalizeRetailer("Foo LLC")).toBe("foo");
    expect(normalizeRetailer("Foo L.L.C.")).toBe("foo");
    expect(normalizeRetailer("Foo Ltd")).toBe("foo");
    expect(normalizeRetailer("Foo Co.")).toBe("foo");
    expect(normalizeRetailer("Foo Company")).toBe("foo");
    expect(normalizeRetailer("Foo Online Store")).toBe("foo");
    expect(normalizeRetailer("Foo Store")).toBe("foo");
  });

  it("does not prefix-truncate — no collision between distinct retailers", () => {
    expect(normalizeRetailer("Buff City Soap")).not.toBe(normalizeRetailer("Buff Beauty"));
    expect(normalizeRetailer("Oak Valley")).not.toBe(normalizeRetailer("Oak Valley Designs"));
  });

  it("does not fuzzy-match co-branded pairs", () => {
    expect(normalizeRetailer("Rufflebutts")).not.toBe(normalizeRetailer("Rufflebutts + Ruggedbutts"));
  });
});

describe("isMeaningfulRetailerChange", () => {
  it("treats case/whitespace-only differences as NOT meaningful", () => {
    expect(isMeaningfulRetailerChange("GAP", "gap")).toBe(false);
    expect(isMeaningfulRetailerChange("  Gap  ", "Gap")).toBe(false);
  });

  it("treats a suffix addition/removal as meaningful — unlike normalizeRetailer", () => {
    expect(isMeaningfulRetailerChange("Gap", "Gap Inc.")).toBe(true);
  });

  it("treats a real correction as meaningful", () => {
    expect(isMeaningfulRetailerChange("Oak Valley", "Oak Valley Designs")).toBe(true);
  });

  it("treats null current retailer as always meaningfully different from a non-empty approval", () => {
    expect(isMeaningfulRetailerChange(null, "Gap")).toBe(true);
  });
});

// D5 (2026-09-16 URL-poisoning fix, TASKS.md) — structural, not a TLD
// allowlist. Every positive case here is a value actually observed
// poisoning Order.retailer in production (2026-09-15/16 diagnostics).
describe("isUrlShapedRetailer", () => {
  it("flags every URL/domain shape observed poisoning Order.retailer", () => {
    const positives = [
      "americangirl.com",
      "shopbop.com",
      "margauxny.loopreturns.com",
      "click.eml.nordstrom.com",
      "https://foo.com",
      "http://foo.com/bar",
      "www.foo.com",
      "FOO.COM",
      "  foo.com  ",
      "mydhl.express.dhl",
      "dermstore.returns.international",
      "www2.hm.com",
    ];
    for (const value of positives) {
      expect(isUrlShapedRetailer(value), `expected "${value}" to be URL-shaped`).toBe(true);
    }
  });

  it("does not flag legitimate retailer names, including ones that contain a dot", () => {
    const negatives = [
      "American Girl",
      "Shopbop",
      "Margaux",
      "H&M",
      "J.Crew",
      "Dr. Scholl's",
      "Bloomingdale's",
      "Nordstrom Rack",
      "eBay",
      "Anaba Wines",
    ];
    for (const value of negatives) {
      expect(isUrlShapedRetailer(value), `expected "${value}" to NOT be URL-shaped`).toBe(false);
    }
  });

  it("treats null/undefined/empty as not URL-shaped", () => {
    expect(isUrlShapedRetailer(null)).toBe(false);
    expect(isUrlShapedRetailer(undefined)).toBe(false);
    expect(isUrlShapedRetailer("")).toBe(false);
    expect(isUrlShapedRetailer("   ")).toBe(false);
  });
});

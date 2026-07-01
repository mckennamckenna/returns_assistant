import { vi, describe, it, expect } from "vitest";

// Prevent module-level Prisma client construction from failing in a test
// environment that has no real DATABASE_URL. The DB-touching functions in
// linkOrder.ts are not exercised by these tests; only the exported pure
// function isRetailerPrefixMatch is tested here.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/crypto", () => ({ decrypt: (x: string) => x }));
vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => null }));
vi.mock("@/lib/extract", () => ({ computeDeadline: () => ({ returnDeadline: null, deadlineIsEstimated: false }) }));
vi.mock("@/lib/displayStatus", async () => {
  const real = await vi.importActual<typeof import("../lib/displayStatus")>("../lib/displayStatus");
  return real;
});
vi.mock("@/lib/trackingParser", () => ({
  parseTracking: () => ({ carrier: null, trackingNumber: null, trackingUrl: null }),
}));

const { isRetailerPrefixMatch } = await import("../lib/linkOrder");

describe("isRetailerPrefixMatch", () => {
  // ── Real fixture ──────────────────────────────────────────────────────────
  // Proenza Schouler shipping email was extracted as "Proenza"; the existing
  // order from the confirmation email had retailer "Proenza Schouler". Exact
  // match failed → new Order card created instead of merging. This test pins
  // the fix: both orderings must return true.
  it("matches when one retailer is a prefix of the other (Proenza / Proenza Schouler)", () => {
    expect(isRetailerPrefixMatch("Proenza", "Proenza Schouler")).toBe(true);
    expect(isRetailerPrefixMatch("Proenza Schouler", "Proenza")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isRetailerPrefixMatch("proenza", "PROENZA SCHOULER")).toBe(true);
    expect(isRetailerPrefixMatch("PROENZA SCHOULER", "proenza")).toBe(true);
  });

  // ── Different order number ────────────────────────────────────────────────
  // isRetailerPrefixMatch only compares retailer strings; the order-number
  // equality check lives in findRetailerPrefixMatchOrder's DB query
  // (WHERE orderNumber = ?, case-insensitive). A different order number on
  // the same retailer pair would never reach isRetailerPrefixMatch at all —
  // the DB query returns no candidates, so the JS filter never runs.
  // Verified in the dry-run / apply path of scripts/backfill-retailer-prefix-match.ts.

  // ── Short-name floor ──────────────────────────────────────────────────────
  it("does not match when the shorter retailer name is below the 4-char floor", () => {
    expect(isRetailerPrefixMatch("Gap", "Gap Kids")).toBe(false);   // "gap"  = 3 chars
    expect(isRetailerPrefixMatch("Net", "Net-a-Porter")).toBe(false); // "net"  = 3 chars
    expect(isRetailerPrefixMatch("Cos", "Cos Clothing")).toBe(false); // "cos"  = 3 chars
  });

  it("matches when the shorter name is exactly 4 characters", () => {
    expect(isRetailerPrefixMatch("Zara", "Zara Home")).toBe(true); // "zara" = 4 chars — at the floor
  });

  it("does not match when neither name is a prefix of the other", () => {
    expect(isRetailerPrefixMatch("Nike", "Reebok")).toBe(false);
    expect(isRetailerPrefixMatch("Banana Republic", "Anthropologie")).toBe(false);
  });

  // ── Known collision risk — documented, not hidden ─────────────────────────
  // "American" (8 chars ≥ 4) is a valid prefix of "American Eagle",
  // "American Vintage", "American Giant", etc. Two orders from different
  // "American X" retailers that happen to share the same order number
  // would be incorrectly merged by findRetailerPrefixMatchOrder.
  //
  // This is an accepted trade-off over the silent worse alternative (duplicate
  // Order cards for one real purchase, with no human-visible signal). Every
  // retailer-prefix merge is flagged needsReview: true AND has an
  // "[auto] retailer prefix match: ..." line appended to Order.userNote,
  // so an admin or user can spot and split a wrong merge via the existing
  // review resolution flow.
  //
  // Tightening the floor or requiring whole-word boundaries would prevent this
  // collision at the cost of missing legitimate partial extractions like
  // "Proenza" / "Proenza Schouler" (where the short form is 7 chars and a
  // real partial extraction, not a collision).
  it("accepts 'American' as a prefix of 'American Eagle' — known collision risk, documented above", () => {
    expect(isRetailerPrefixMatch("American", "American Eagle")).toBe(true);
    expect(isRetailerPrefixMatch("American", "American Vintage")).toBe(true);
    // Both return true. Any merge they produce is needsReview + logged.
  });
});

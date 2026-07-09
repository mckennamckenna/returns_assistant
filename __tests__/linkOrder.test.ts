import { vi, describe, it, expect, beforeEach } from "vitest";

// Prevent module-level Prisma client construction from failing in a test
// environment that has no real DATABASE_URL. isRetailerPrefixMatch and
// parseForwardedHeaderDate are pure functions and don't touch this mock at
// all; applyFallbackOrderDate does, via the vi.fn()s below.
const mockPrisma = {
  order: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  email: {
    findFirst: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
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

const { isRetailerPrefixMatch, parseForwardedHeaderDate, applyFallbackOrderDate } = await import("../lib/linkOrder");

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

describe("parseForwardedHeaderDate", () => {
  it("parses a Gmail-style forwarded header", () => {
    const body = "---------- Forwarded message ---------\nFrom: Retailer <hi@retailer.com>\nDate: Tue, May 19, 2026 at 4:21 PM\nSubject: Your order\n\nThanks for your order.";
    const parsed = parseForwardedHeaderDate(body);
    expect(parsed?.toISOString().slice(0, 10)).toBe("2026-05-19");
  });

  it("parses an Apple Mail-style forwarded header quoted with '> '", () => {
    const body = "> Begin forwarded message:\n>\n> From: Retailer <hi@retailer.com>\n> Date: April 22, 2026 at 3:07:10 PM PDT\n> Subject: Your order\n>\n> Thanks for your order.";
    const parsed = parseForwardedHeaderDate(body);
    expect(parsed?.toISOString().slice(0, 10)).toBe("2026-04-22");
  });

  it("returns null when there's no forwarded-header Date line (Bug 8: Amazon relays directly, no quote block)", () => {
    const body = "Your Orders\n\nThanks for your order!\nOrdered\nShipped\nOut for delivery\nDelivered\n\nOrder #\n114-4807161-9433864";
    expect(parseForwardedHeaderDate(body)).toBeNull();
  });

  it("returns null for an empty body", () => {
    expect(parseForwardedHeaderDate(null)).toBeNull();
  });
});

describe("applyFallbackOrderDate", () => {
  const baseOrder = {
    id: "order1",
    orderDate: null,
    deliveredAt: null,
    estimatedDeliveryDate: null,
    returnWindowDays: null,
    returnWindowStartsFrom: null,
  };
  const receivedAt = new Date("2026-06-01T00:00:00.000Z");

  beforeEach(() => {
    mockPrisma.order.findUnique.mockReset();
    mockPrisma.order.update.mockReset();
    mockPrisma.email.findFirst.mockReset();
  });

  // ── Allowed types: fallback fires ───────────────────────────────────────
  it.each(["order_confirmation", "shipping_confirmation", "delivery"])(
    "fires when the earliest-linked email is %s",
    async (emailType) => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst
        .mockResolvedValueOnce({ emailType }) // gate check
        .mockResolvedValueOnce({ receivedAt, textBody: null, htmlBody: null }); // resolveFallbackOrderDate

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(receivedAt);
      expect(data.orderDateEstimated).toBe(true);
    },
  );

  // ── Excluded types: fallback stays null ─────────────────────────────────
  it.each(["return_label", "refund", "other"])(
    "does NOT fire when the earliest-linked email is %s",
    async (emailType) => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst.mockResolvedValueOnce({ emailType }); // gate check only

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    },
  );

  // ── Edge case: Order has no linked emails at all ────────────────────────
  it("does NOT fire when the order has no linked emails", async () => {
    mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
    mockPrisma.email.findFirst.mockResolvedValueOnce(null);

    await applyFallbackOrderDate("order1");

    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  // ── Early-return path: Order already has a real orderDate ───────────────
  it("does NOT fire when the order already has a non-null orderDate, regardless of emailType", async () => {
    mockPrisma.order.findUnique.mockResolvedValueOnce({ ...baseOrder, orderDate: new Date("2026-05-01") });

    await applyFallbackOrderDate("order1");

    expect(mockPrisma.email.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});

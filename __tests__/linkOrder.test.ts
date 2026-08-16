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
vi.mock("@/lib/extract", () => ({
  computeDeadline: () => ({ returnDeadline: null, deadlineIsEstimated: false }),
  normalizeReturnPortalUrl: (url: string | null) => url ?? null,
}));
vi.mock("@/lib/displayStatus", async () => {
  const real = await vi.importActual<typeof import("../lib/displayStatus")>("../lib/displayStatus");
  return real;
});
vi.mock("@/lib/trackingParser", () => ({
  parseTracking: () => ({ carrier: null, trackingNumber: null, trackingUrl: null }),
}));

const {
  isRetailerPrefixMatch,
  parseForwardedHeaderDate,
  applyFallbackOrderDate,
  computeKeptStatusConflict,
  mergeEmailIntoOrder,
} = await import("../lib/linkOrder");

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

describe("computeKeptStatusConflict", () => {
  it("flags a return_label email arriving on a kept order, with a note", () => {
    const result = computeKeptStatusConflict("kept", "return_label");
    expect(result.isKeptStatusConflict).toBe(true);
    expect(result.note).toContain("return_label");
    expect(result.note).toContain("Kept");
  });

  it("flags a refund email arriving on a kept order, with a note", () => {
    const result = computeKeptStatusConflict("kept", "refund");
    expect(result.isKeptStatusConflict).toBe(true);
    expect(result.note).toContain("refund");
    expect(result.note).toContain("Kept");
  });

  it("does not flag other email types arriving on a kept order", () => {
    for (const emailType of ["order_confirmation", "shipping_confirmation", "delivery", "other", null]) {
      const result = computeKeptStatusConflict("kept", emailType);
      expect(result.isKeptStatusConflict).toBe(false);
      expect(result.note).toBeNull();
    }
  });

  it("does not flag return_label/refund emails on a non-kept order", () => {
    for (const displayStatus of ["ordered", "shipped", "return_requested", "returned", "refunded", null]) {
      expect(computeKeptStatusConflict(displayStatus, "return_label").isKeptStatusConflict).toBe(false);
      expect(computeKeptStatusConflict(displayStatus, "refund").isKeptStatusConflict).toBe(false);
    }
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

  // ── ANCHOR_DATE_RESOLVER.md (2026-07-25): forwardType-stamp transition ──
  describe("anchor resolver integration", () => {
    const anchorDate = new Date("2026-06-02T10:00:00.000Z");

    it("trusts a resolver-processed manual row's anchorDate directly, without re-parsing the body", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst
        .mockResolvedValueOnce({ emailType: "order_confirmation" })
        .mockResolvedValueOnce({
          receivedAt,
          textBody: "irrelevant — should not be read",
          htmlBody: null,
          forwardType: "manual",
          anchorDate,
        });

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update.mock.calls[0][0].data.orderDate).toEqual(anchorDate);
    });

    it("trusts a resolver-processed auto row's anchorDate directly too", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst
        .mockResolvedValueOnce({ emailType: "shipping_confirmation" })
        .mockResolvedValueOnce({ receivedAt, textBody: null, htmlBody: null, forwardType: "auto", anchorDate });

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update.mock.calls[0][0].data.orderDate).toEqual(anchorDate);
    });

    it("does NOT fire — and never falls back to receivedAt — when a resolver-processed manual row's anchorDate is null (genuinely unresolved)", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst
        .mockResolvedValueOnce({ emailType: "order_confirmation" })
        .mockResolvedValueOnce({ receivedAt, textBody: null, htmlBody: null, forwardType: "manual", anchorDate: null });

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it("keeps the original parse-or-receivedAt behavior for a pre-resolver row (forwardType null — never classified)", async () => {
      mockPrisma.order.findUnique.mockResolvedValueOnce(baseOrder);
      mockPrisma.email.findFirst
        .mockResolvedValueOnce({ emailType: "order_confirmation" })
        .mockResolvedValueOnce({ receivedAt, textBody: null, htmlBody: null, forwardType: null, anchorDate: null });

      await applyFallbackOrderDate("order1");

      expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update.mock.calls[0][0].data.orderDate).toEqual(receivedAt);
    });
  });
});

// ── write-once orderDate (2026-08-16) ─────────────────────────────────────
// Real production fixture: an order's orderDate must be set once from the
// earliest establishing email and never move again, even from a LATER
// establishing-typed email — a same-type allowlist alone isn't enough (a
// delivery email arriving after order_confirmation is still "establishing"
// but its date must not overwrite the earlier, correct one). See TASKS.md
// 2026-08-16 and the comment on mergeEmailIntoOrder itself.
describe("mergeEmailIntoOrder — write-once orderDate", () => {
  const baseExisting = {
    id: "order1",
    orderDate: null as Date | null,
    orderDateEstimated: false,
    deliveryDate: null,
    estimatedDeliveryDate: null,
    deliveredAt: null,
    returnWindowDays: 30,
    returnWindowStartsFrom: "delivery_date",
    orderTotal: null,
    orderCurrency: null,
    lineItems: [],
    returnPortalUrl: null,
    policySource: null,
  };

  function makeEmail(overrides: Record<string, unknown>) {
    return {
      emailType: null,
      orderDate: null,
      deliveryDate: null,
      estimatedDeliveryDate: null,
      deliveredAt: null,
      returnWindowDays: null,
      returnWindowStartsFrom: null,
      orderTotal: null,
      orderCurrency: null,
      lineItems: [],
      policySource: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPrisma.order.update.mockReset();
    mockPrisma.order.update.mockResolvedValue({ id: "order1" });
    mockPrisma.email.findFirst.mockReset();
    // resolveOrderTotal's own findFirst lookup for a sibling order_confirmation
    // — no confirmation exists in these fixtures, so it falls through to
    // email.orderTotal ?? existing.orderTotal.
    mockPrisma.email.findFirst.mockResolvedValue(null);
  });

  // ── Amazon non-regression: shipping_confirmation is Amazon's earliest
  // establishing type (Amazon never produces order_confirmation) — the
  // write-once gate must still let it establish orderDate on first merge. ──
  it("Amazon non-regression: shipping_confirmation still establishes orderDate on first merge", async () => {
    const shipDate = new Date("2026-07-01T00:00:00.000Z");
    const email = makeEmail({ emailType: "shipping_confirmation", orderDate: shipDate });

    await mergeEmailIntoOrder(baseExisting as any, email as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(shipDate);
    expect(data.orderDateEstimated).toBe(false);
  });

  it("Amazon non-regression: a later delivery email does not move the orderDate a shipping_confirmation already set", async () => {
    const shipDate = new Date("2026-07-01T00:00:00.000Z");
    const existingAfterShipping = { ...baseExisting, orderDate: shipDate, orderDateEstimated: false };
    const deliveryEmail = makeEmail({ emailType: "delivery", orderDate: new Date("2026-07-10T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterShipping as any, deliveryEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(shipDate); // unchanged, not the delivery date
    expect(data.orderDateEstimated).toBe(false);
  });

  // ── Suzie Kondi replay: order_confirmation (2026-07-23) already
  // established orderDate; a later delivery email (2026-07-31) must not
  // move it, even though delivery is itself an establishing type. ──
  it("Suzie delivery-email replay: does not move an orderDate order_confirmation already established", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    const existingAfterConfirmation = { ...baseExisting, orderDate: confirmedDate, orderDateEstimated: false };
    const deliveryEmail = makeEmail({ emailType: "delivery", orderDate: new Date("2026-07-31T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterConfirmation as any, deliveryEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate); // unchanged, not the delivery date
    expect(data.orderDateEstimated).toBe(false);
  });

  // ── Suzie Kondi replay: the actual bug fixture. A refund email arriving
  // after order_confirmation must not overwrite orderDate OR flip
  // orderDateEstimated — this is the exact production corruption. ──
  it("refund-after-confirmation replay: does not overwrite orderDate, orderDateEstimated left untouched", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    const existingAfterConfirmation = { ...baseExisting, orderDate: confirmedDate, orderDateEstimated: false };
    // Mirrors the real Suzie Kondi refund email: emailType "refund", with
    // its own extracted orderDate equal to its own receivedAt (2026-08-12),
    // not the true purchase date.
    const refundEmail = makeEmail({ emailType: "refund", orderDate: new Date("2026-08-12T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterConfirmation as any, refundEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate); // NOT 2026-08-12
    expect(data.orderDateEstimated).toBe(false); // untouched, not reset
  });

  // ── First-write gate: a non-establishing email as the FIRST-ever linked
  // email must not establish orderDate either (mirrors the J.Crew
  // #2523415500 orphan — a lone refund email creating an order with
  // orderDate left null, not set to the refund's own date). ──
  it("a refund email never establishes orderDate when nothing has set it yet", async () => {
    const refundEmail = makeEmail({ emailType: "refund", orderDate: new Date("2026-08-12T00:00:00.000Z") });

    await mergeEmailIntoOrder(baseExisting as any, refundEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toBeNull();
    expect(data.orderDateEstimated).toBe(false);
  });

  it("an order_confirmation establishes orderDate on first merge and clears orderDateEstimated", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    const email = makeEmail({ emailType: "order_confirmation", orderDate: confirmedDate });

    await mergeEmailIntoOrder({ ...baseExisting, orderDateEstimated: true } as any, email as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate);
    expect(data.orderDateEstimated).toBe(false);
  });
});

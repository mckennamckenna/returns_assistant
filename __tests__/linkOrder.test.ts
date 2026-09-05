import { vi, describe, it, expect, beforeEach } from "vitest";

// Prevent module-level Prisma client construction from failing in a test
// environment that has no real DATABASE_URL. isRetailerPrefixMatch and
// parseForwardedHeaderDate are pure functions and don't touch this mock at
// all; applyFallbackOrderDate does, via the vi.fn()s below.
const mockPrisma = {
  order: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  email: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  actionLog: {
    findFirst: vi.fn(),
    create: vi.fn(),
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
  parseTrackingResolved: () => ({ carrier: null, trackingNumber: null, trackingUrl: null }),
}));

const {
  isRetailerPrefixMatch,
  parseForwardedHeaderDate,
  applyFallbackOrderDate,
  computeKeptStatusConflict,
  mergeEmailIntoOrder,
  linkEmailToOrder,
  resolveDeliveredAtBackfill,
  recomputeDisplayStatus,
  createOrderFromEmail,
  findShipmentMergeCandidates,
  detectMultiShipment,
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

describe("detectMultiShipment", () => {
  beforeEach(() => {
    mockPrisma.actionLog.findFirst.mockReset();
    mockPrisma.actionLog.create.mockReset();
    mockPrisma.actionLog.findFirst.mockResolvedValue(null);
  });

  it("logs a marker when a second shipping email has a different tracking number", async () => {
    await detectMultiShipment("order1", "user1", "1Z999AA10123456784", "9400111899223197428070");
    expect(mockPrisma.actionLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.actionLog.create.mock.calls[0][0].data).toMatchObject({
      orderId: "order1",
      userId: "user1",
      action: "multi_shipment_detected",
      outcome: "success",
    });
  });

  it("does not log when the tracking number is the same", async () => {
    await detectMultiShipment("order1", "user1", "1Z999AA10123456784", "1Z999AA10123456784");
    expect(mockPrisma.actionLog.create).not.toHaveBeenCalled();
  });

  it("does not log when either tracking number is missing", async () => {
    await detectMultiShipment("order1", "user1", null, "9400111899223197428070");
    await detectMultiShipment("order1", "user1", "1Z999AA10123456784", null);
    await detectMultiShipment("order1", "user1", null, null);
    expect(mockPrisma.actionLog.create).not.toHaveBeenCalled();
  });

  it("is idempotent: does not log again if a marker already exists for this order", async () => {
    mockPrisma.actionLog.findFirst.mockResolvedValue({ id: "existing-log" });
    await detectMultiShipment("order1", "user1", "1Z999AA10123456784", "9400111899223197428070");
    expect(mockPrisma.actionLog.create).not.toHaveBeenCalled();
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

// TASKS.md 2026-08-27, diagnosis commit 179389e — the third of three
// orderDate write sites needing orderDateSource.
describe("createOrderFromEmail — orderDateSource", () => {
  const baseEmail = {
    retailer: "Zara",
    orderNumber: "54421192781",
    emailType: "order_confirmation" as string | null,
    orderDate: null as Date | null,
    anchorDate: null as Date | null,
    deliveryDate: null,
    estimatedDeliveryDate: null,
    deliveredAt: null,
    returnWindowDays: null,
    returnWindowStartsFrom: null,
    returnDeadline: null,
    deadlineIsEstimated: false,
    policySource: null,
    orderTotal: null,
    orderCurrency: null,
    lineItems: [],
  };

  beforeEach(() => {
    mockPrisma.order.create.mockReset();
    mockPrisma.order.create.mockResolvedValue({ id: "order1" });
  });

  it("sets orderDateSource 'extracted' when the triggering email has its own extracted orderDate", async () => {
    const extractedDate = new Date("2026-07-23T00:00:00.000Z");
    await createOrderFromEmail("user1", { ...baseEmail, orderDate: extractedDate } as any, null);

    const data = mockPrisma.order.create.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(extractedDate);
    expect(data.orderDateSource).toBe("extracted");
  });

  it("leaves orderDateSource unset (falls to the schema default 'unknown') when the triggering email has no extracted orderDate — applyFallbackOrderDate sets it afterward if its heuristic fires", async () => {
    await createOrderFromEmail("user1", { ...baseEmail, orderDate: null } as any, null);

    const data = mockPrisma.order.create.mock.calls[0][0].data;
    expect(data.orderDate).toBeNull();
    expect(data.orderDateSource).toBeUndefined();
  });

  it("priority 2: uses an order_confirmation's anchorDate when its own orderDate field is null", async () => {
    const anchorDate = new Date("2026-08-16T05:13:00.000Z");
    await createOrderFromEmail("user1", { ...baseEmail, emailType: "order_confirmation", orderDate: null, anchorDate } as any, null);

    const data = mockPrisma.order.create.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(anchorDate);
    expect(data.orderDateSource).toBe("extracted");
  });

  it("priority 2 does NOT apply when the triggering email is not an order_confirmation", async () => {
    const anchorDate = new Date("2026-08-16T05:13:00.000Z");
    await createOrderFromEmail("user1", { ...baseEmail, emailType: "shipping_confirmation", orderDate: null, anchorDate } as any, null);

    const data = mockPrisma.order.create.mock.calls[0][0].data;
    expect(data.orderDate).toBeNull();
    expect(data.orderDateSource).toBeUndefined();
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
      // TASKS.md 2026-08-27, diagnosis commit 179389e — marks this as a
      // heuristic guess so mergeEmailIntoOrder's provenance-aware rule
      // knows a later extracted date is still allowed to correct it.
      expect(data.orderDateSource).toBe("fallback");
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

// ── DELIVERED_BADGE_DESIGN_20260827.md Option A ────────────────────────────
// deriveDisplayStatus's 2026-07-23 AquaTru fix advances displayStatus to
// "delivered" off a linked "delivery"-type email alone, even with no
// extractable date — but lib/orderCardState.ts's card state machine only
// trusts deliveredAt (its "O7" invariant), so that order stays visually
// stuck on the "Arrives" chip forever. resolveDeliveredAtBackfill closes
// that gap for the one case the design doc found safe: a Gmail
// auto-forwarded delivery email, where the forward-resolver's anchorDate
// (lib/forwardResolver.ts) already equals receivedAt in every observed
// case, so it's a trustworthy same-day delivery-date proxy.
describe("resolveDeliveredAtBackfill", () => {
  const anchorDate = new Date("2026-08-22T20:41:07.000Z");

  it("backfills from an auto-forward delivery email with no body date", () => {
    const emails = [{ emailType: "delivery", forwardType: "auto", deliveryDate: null, anchorDate }];
    expect(resolveDeliveredAtBackfill(emails, null)).toEqual(anchorDate);
  });

  it("does NOT backfill when the delivery email's body already has a date (extractor already handled it)", () => {
    const emails = [
      { emailType: "delivery", forwardType: "auto", deliveryDate: new Date("2026-08-22T00:00:00.000Z"), anchorDate },
    ];
    expect(resolveDeliveredAtBackfill(emails, null)).toBeNull();
  });

  it("does NOT backfill for a manually-forwarded delivery email — fallback B territory, not this fix", () => {
    const emails = [{ emailType: "delivery", forwardType: "manual", deliveryDate: null, anchorDate }];
    expect(resolveDeliveredAtBackfill(emails, null)).toBeNull();
  });

  it("does NOT backfill for an unclassified (pre-resolver) delivery email — forwardType null is not 'auto'", () => {
    const emails = [{ emailType: "delivery", forwardType: null, deliveryDate: null, anchorDate }];
    expect(resolveDeliveredAtBackfill(emails, null)).toBeNull();
  });

  it("does NOT overwrite an already-set deliveredAt", () => {
    const emails = [{ emailType: "delivery", forwardType: "auto", deliveryDate: null, anchorDate }];
    expect(resolveDeliveredAtBackfill(emails, new Date("2026-08-20T00:00:00.000Z"))).toBeNull();
  });

  it("does NOT backfill when anchorDate itself is null (genuinely unresolved, never invent a date)", () => {
    const emails = [{ emailType: "delivery", forwardType: "auto", deliveryDate: null, anchorDate: null }];
    expect(resolveDeliveredAtBackfill(emails, null)).toBeNull();
  });

  it("ignores non-delivery-typed emails entirely, even if auto-forwarded with a null date", () => {
    const emails = [{ emailType: "shipping_confirmation", forwardType: "auto", deliveryDate: null, anchorDate }];
    expect(resolveDeliveredAtBackfill(emails, null)).toBeNull();
  });

  it("picks the earliest anchorDate when more than one qualifying delivery email exists", () => {
    const earlier = new Date("2026-08-20T00:00:00.000Z");
    const later = new Date("2026-08-22T20:41:07.000Z");
    const emails = [
      { emailType: "delivery", forwardType: "auto", deliveryDate: null, anchorDate: later },
      { emailType: "delivery", forwardType: "auto", deliveryDate: null, anchorDate: earlier },
    ];
    expect(resolveDeliveredAtBackfill(emails, null)).toEqual(earlier);
  });
});

describe("recomputeDisplayStatus — deliveredAt backfill integration", () => {
  beforeEach(() => {
    mockPrisma.order.findUniqueOrThrow.mockReset();
    mockPrisma.email.findMany.mockReset();
    mockPrisma.order.update.mockReset();
  });

  const anchorDate = new Date("2026-08-22T20:41:07.000Z");

  it("the Zara #54421192781 shape: writes deliveredAt alongside the displayStatus advance in one update", async () => {
    mockPrisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      displayStatus: "shipped",
      returnedAt: null,
      archivedAt: null,
      deliveredAt: null,
    });
    mockPrisma.email.findMany.mockResolvedValueOnce([
      { emailType: "delivery", refundAmount: null, refundAmountConfidence: null, forwardType: "auto", deliveryDate: null, anchorDate },
    ]);

    await recomputeDisplayStatus("order1");

    expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.displayStatus).toBe("delivered");
    expect(data.deliveredAt).toEqual(anchorDate);
  });

  it("backfills deliveredAt even when displayStatus was already 'delivered' from an earlier pass", async () => {
    mockPrisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      displayStatus: "delivered",
      returnedAt: null,
      archivedAt: null,
      deliveredAt: null,
    });
    mockPrisma.email.findMany.mockResolvedValueOnce([
      { emailType: "delivery", refundAmount: null, refundAmountConfidence: null, forwardType: "auto", deliveryDate: null, anchorDate },
    ]);

    await recomputeDisplayStatus("order1");

    expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.deliveredAt).toEqual(anchorDate);
    expect(data.displayStatus).toBeUndefined(); // no status transition, so buildStatusTransitionData wasn't invoked
  });

  it("does not write at all for a manual-forward delivery email with no body date (fallback B territory)", async () => {
    mockPrisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      displayStatus: "shipped",
      returnedAt: null,
      archivedAt: null,
      deliveredAt: null,
    });
    mockPrisma.email.findMany.mockResolvedValueOnce([
      { emailType: "delivery", refundAmount: null, refundAmountConfidence: null, forwardType: "manual", deliveryDate: null, anchorDate },
    ]);

    await recomputeDisplayStatus("order1");

    // displayStatus still advances to "delivered" (deriveDisplayStatus's
    // existing AquaTru-fix behavior, unchanged) but deliveredAt is NOT
    // backfilled — this write happens for the status transition alone.
    expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.displayStatus).toBe("delivered");
    expect(data.deliveredAt).toBeUndefined();
  });

  it("does not overwrite an already-set deliveredAt, even if a later auto-forward delivery email is linked", async () => {
    const existingDeliveredAt = new Date("2026-08-20T00:00:00.000Z");
    mockPrisma.order.findUniqueOrThrow.mockResolvedValueOnce({
      displayStatus: "delivered",
      returnedAt: null,
      archivedAt: null,
      deliveredAt: existingDeliveredAt,
    });
    mockPrisma.email.findMany.mockResolvedValueOnce([
      { emailType: "delivery", refundAmount: null, refundAmountConfidence: null, forwardType: "auto", deliveryDate: null, anchorDate },
    ]);

    await recomputeDisplayStatus("order1");

    expect(mockPrisma.order.update).not.toHaveBeenCalled();
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
      anchorDate: null,
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
    expect(data.orderDateSource).toBe("extracted");
    expect(data.orderDateEstimated).toBe(false);
  });

  it("Amazon non-regression: a later delivery email does not move the orderDate a shipping_confirmation already set", async () => {
    const shipDate = new Date("2026-07-01T00:00:00.000Z");
    // orderDateSource: "extracted" — this is how the first merge (the test
    // above) actually leaves it: an establishing email's own extracted
    // orderDate. TASKS.md 2026-08-27 — provenance-aware orderDate no
    // longer treats "already set" alone as enough to block an overwrite;
    // it must specifically be "extracted" to stay locked.
    const existingAfterShipping = { ...baseExisting, orderDate: shipDate, orderDateSource: "extracted", orderDateEstimated: false };
    const deliveryEmail = makeEmail({ emailType: "delivery", orderDate: new Date("2026-07-10T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterShipping as any, deliveryEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(shipDate); // unchanged, not the delivery date
    expect(data.orderDateSource).toBe("extracted");
    expect(data.orderDateEstimated).toBe(false);
  });

  // ── Suzie Kondi replay: order_confirmation (2026-07-23) already
  // established orderDate; a later delivery email (2026-07-31) must not
  // move it, even though delivery is itself an establishing type. ──
  it("Suzie delivery-email replay: does not move an orderDate order_confirmation already established", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    // orderDateSource: "extracted" — see the shipping-confirmation case
    // above for why this fixture needs it under the provenance-aware rule.
    const existingAfterConfirmation = { ...baseExisting, orderDate: confirmedDate, orderDateSource: "extracted", orderDateEstimated: false };
    const deliveryEmail = makeEmail({ emailType: "delivery", orderDate: new Date("2026-07-31T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterConfirmation as any, deliveryEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate); // unchanged, not the delivery date
    expect(data.orderDateSource).toBe("extracted");
    expect(data.orderDateEstimated).toBe(false);
  });

  // ── Suzie Kondi replay: the actual bug fixture. A refund email arriving
  // after order_confirmation must not overwrite orderDate OR flip
  // orderDateEstimated — this is the exact production corruption. ──
  it("refund-after-confirmation replay: does not overwrite orderDate, orderDateEstimated left untouched", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    const existingAfterConfirmation = { ...baseExisting, orderDate: confirmedDate, orderDateSource: "extracted", orderDateEstimated: false };
    // Mirrors the real Suzie Kondi refund email: emailType "refund", with
    // its own extracted orderDate equal to its own receivedAt (2026-08-12),
    // not the true purchase date. Blocked TWO ways here — existing source
    // is "extracted" (never overwritten regardless of type), AND "refund"
    // isn't an establishing type either (J.Crew #2523415500 gate) — either
    // alone would be enough, both apply.
    const refundEmail = makeEmail({ emailType: "refund", orderDate: new Date("2026-08-12T00:00:00.000Z") });

    await mergeEmailIntoOrder(existingAfterConfirmation as any, refundEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate); // NOT 2026-08-12
    expect(data.orderDateSource).toBe("extracted");
    expect(data.orderDateEstimated).toBe(false); // untouched, not reset
  });

  // ── First-write gate: a non-establishing email as the FIRST-ever linked
  // email must not establish orderDate either (mirrors the J.Crew
  // #2523415500 orphan — a lone refund email creating an order with
  // orderDate left null, not set to the refund's own date). Confirmed
  // 2026-08-27 (this session) to still hold under the provenance-aware
  // rule — refund is blocked by the ALLOWED_FALLBACK_EMAIL_TYPES type
  // gate regardless of source, deliberately kept for exactly this case.
  it("a refund email never establishes orderDate when nothing has set it yet", async () => {
    const refundEmail = makeEmail({ emailType: "refund", orderDate: new Date("2026-08-12T00:00:00.000Z") });

    await mergeEmailIntoOrder(baseExisting as any, refundEmail as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toBeNull();
    expect(data.orderDateSource).toBe("unknown");
    expect(data.orderDateEstimated).toBe(false);
  });

  it("an order_confirmation establishes orderDate on first merge and clears orderDateEstimated", async () => {
    const confirmedDate = new Date("2026-07-23T00:00:00.000Z");
    const email = makeEmail({ emailType: "order_confirmation", orderDate: confirmedDate });

    await mergeEmailIntoOrder({ ...baseExisting, orderDateEstimated: true } as any, email as any, null);

    const data = mockPrisma.order.update.mock.calls[0][0].data;
    expect(data.orderDate).toEqual(confirmedDate);
    expect(data.orderDateSource).toBe("extracted");
    expect(data.orderDateEstimated).toBe(false);
  });

  // ── TASKS.md 2026-08-27, diagnosis commit 179389e — the actual bug fix,
  // replaying the Zara #54421192781 shape end-to-end. ──
  describe("provenance-aware overwrite (2026-08-27 fix)", () => {
    it("an extracted orderDate overwrites a fallback-sourced one", async () => {
      const fallbackDate = new Date("2026-08-22T20:41:07.000Z"); // the Zara delivery email's own receivedAt
      const extractedDate = new Date("2026-08-16T05:13:00.000Z"); // the Zara order_confirmation's real forwarded-header date
      const existingWithFallback = { ...baseExisting, orderDate: fallbackDate, orderDateSource: "fallback", orderDateEstimated: true };
      const orderConfirmation = makeEmail({ emailType: "order_confirmation", orderDate: extractedDate });

      await mergeEmailIntoOrder(existingWithFallback as any, orderConfirmation as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(extractedDate);
      expect(data.orderDateSource).toBe("extracted");
      expect(data.orderDateEstimated).toBe(false);
    });

    it("an extracted orderDate overwrites an 'unknown'-sourced one (pre-migration row)", async () => {
      const priorDate = new Date("2026-07-01T00:00:00.000Z");
      const extractedDate = new Date("2026-06-28T00:00:00.000Z");
      // No orderDateSource key at all — simulates a pre-migration row,
      // same as this fixture's every other test until now; ?? "unknown"
      // in the implementation treats it identically to an explicit "unknown".
      const existingUnknownSource = { ...baseExisting, orderDate: priorDate };
      const orderConfirmation = makeEmail({ emailType: "order_confirmation", orderDate: extractedDate });

      await mergeEmailIntoOrder(existingUnknownSource as any, orderConfirmation as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(extractedDate);
      expect(data.orderDateSource).toBe("extracted");
      expect(data.orderDateEstimated).toBe(false);
    });

    it("a fallback-typed incoming email never overwrites anything (fallback only ever comes from applyFallbackOrderDate, never from a merge)", async () => {
      // mergeEmailIntoOrder only ever receives an email's own EXTRACTED
      // orderDate — there is no "fallback" value an incoming email can
      // carry, so an email with orderDate: null (nothing extracted) must
      // never change an existing fallback-sourced value either.
      const fallbackDate = new Date("2026-08-22T20:41:07.000Z");
      const existingWithFallback = { ...baseExisting, orderDate: fallbackDate, orderDateSource: "fallback", orderDateEstimated: true };
      const shippingEmailNoDate = makeEmail({ emailType: "shipping_confirmation", orderDate: null });

      await mergeEmailIntoOrder(existingWithFallback as any, shippingEmailNoDate as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(fallbackDate);
      expect(data.orderDateSource).toBe("fallback");
      expect(data.orderDateEstimated).toBe(true);
    });

    // ── Priority 2 (2026-08-27 investigation, read-only diagnosis before
    // implementing): an order_confirmation with no AI-extracted orderDate
    // but a real forward-resolver anchorDate still counts as "extracted" —
    // this is specifically what fixes Zara #54421192781 (its
    // order_confirmation's own orderDate field was null; the real date
    // only existed as anchorDate, parsed from the forwarded header). ──
    it("priority 2: an order_confirmation's anchorDate counts as extracted when its own orderDate field is null", async () => {
      const fallbackDate = new Date("2026-08-22T20:41:07.000Z"); // Zara's delivery-email-sourced fallback
      const zaraAnchorDate = new Date("2026-08-16T05:13:00.000Z"); // Zara's real forwarded-header date
      const existingWithFallback = { ...baseExisting, orderDate: fallbackDate, orderDateSource: "fallback", orderDateEstimated: true };
      const orderConfirmationNoExtractedDate = makeEmail({
        emailType: "order_confirmation",
        orderDate: null,
        anchorDate: zaraAnchorDate,
      });

      await mergeEmailIntoOrder(existingWithFallback as any, orderConfirmationNoExtractedDate as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(zaraAnchorDate);
      expect(data.orderDateSource).toBe("extracted");
      expect(data.orderDateEstimated).toBe(false);
    });

    it("priority 2 does NOT apply to shipping_confirmation/delivery — anchorDate is only trusted from order_confirmation", async () => {
      // 2026-08-27 investigation deliberately did not adopt this broader
      // gate (would additionally fix Shopbop #143429832, but wasn't
      // validated) — a shipping/delivery email's anchorDate must NOT
      // establish or overwrite orderDate, even with no AI-extracted date.
      const fallbackDate = new Date("2026-08-22T20:41:07.000Z");
      const existingWithFallback = { ...baseExisting, orderDate: fallbackDate, orderDateSource: "fallback", orderDateEstimated: true };
      const shippingEmailAnchorOnly = makeEmail({
        emailType: "shipping_confirmation",
        orderDate: null,
        anchorDate: new Date("2026-08-01T00:00:00.000Z"),
      });

      await mergeEmailIntoOrder(existingWithFallback as any, shippingEmailAnchorOnly as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(fallbackDate); // unchanged
      expect(data.orderDateSource).toBe("fallback");
      expect(data.orderDateEstimated).toBe(true);
    });

    it("priority 1 (AI-extracted orderDate) wins over priority 2 (anchorDate) when both exist on the same order_confirmation", async () => {
      const extractedDate = new Date("2026-07-23T00:00:00.000Z");
      const anchorDate = new Date("2026-07-24T10:00:00.000Z");
      const orderConfirmationBoth = makeEmail({ emailType: "order_confirmation", orderDate: extractedDate, anchorDate });

      await mergeEmailIntoOrder(baseExisting as any, orderConfirmationBoth as any, null);

      const data = mockPrisma.order.update.mock.calls[0][0].data;
      expect(data.orderDate).toEqual(extractedDate); // not anchorDate
      expect(data.orderDateSource).toBe("extracted");
    });
  });
});

// ── linkEmailToOrder — retailer-name backstop ────────────────────────────
// Food + grocery delivery exclusion (TASKS.md 🔴 Now, 2026-08-18). Amazon
// Fresh / Whole Foods Market share Amazon's generic sender domain, so
// they're caught here, post-extraction, on the retailer name — before any
// order-matching/creation logic runs. Only the email table needs mocking:
// a match returns before the order table is ever touched.

describe("linkEmailToOrder — retailer-name backstop", () => {
  beforeEach(() => {
    mockPrisma.email.findUnique.mockReset();
    mockPrisma.email.update.mockReset();
    mockPrisma.order.findUnique.mockReset();
    mockPrisma.order.update.mockReset();
  });

  it("junks an Amazon Fresh email and returns before touching the order table", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_1",
      retailer: "Amazon Fresh",
      orderNumber: "112-1234567-1234567",
      emailType: "order_confirmation",
      junkedAt: null,
    });

    await linkEmailToOrder("email_1");

    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email_1" },
      data: { junkedAt: expect.any(Date) },
    });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("junks a Whole Foods Market email the same way", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_2",
      retailer: "Whole Foods Market",
      orderNumber: "WF-123",
      emailType: "order_confirmation",
      junkedAt: null,
    });

    await linkEmailToOrder("email_2");

    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email_2" },
      data: { junkedAt: expect.any(Date) },
    });
  });

  it("is case-insensitive on the retailer name", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_3",
      retailer: "amazon fresh",
      orderNumber: "112-1234567-1234567",
      emailType: "order_confirmation",
      junkedAt: null,
    });

    await linkEmailToOrder("email_3");

    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email_3" },
      data: { junkedAt: expect.any(Date) },
    });
  });

  it("idempotent: does NOT overwrite an already-set junkedAt", async () => {
    const alreadyJunkedAt = new Date("2026-08-01T00:00:00.000Z");
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_4",
      retailer: "Amazon Fresh",
      orderNumber: "112-1234567-1234567",
      emailType: "order_confirmation",
      junkedAt: alreadyJunkedAt,
    });

    await linkEmailToOrder("email_4");

    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("leaves a real Amazon (non-food) email untouched by the backstop — falls through to the normal orphan path instead", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_5",
      retailer: "Amazon",
      orderNumber: null,
      emailType: "order_confirmation",
      junkedAt: null,
    });

    await linkEmailToOrder("email_5");

    // Reached the pre-existing orphan branch (no orderNumber, real
    // "order_confirmation" so shouldAutoJunk's emailType rule doesn't
    // fire either) — needsReview: true, no junkedAt. Proves the backstop
    // itself never matched "Amazon".
    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email_5" },
      data: { needsReview: true },
    });
  });

  it("does not junk an unrelated retailer", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({
      id: "email_6",
      retailer: "Mango",
      orderNumber: null,
      emailType: "order_confirmation",
      junkedAt: null,
    });

    await linkEmailToOrder("email_6");

    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email_6" },
      data: { needsReview: true },
    });
  });
});

describe("findShipmentMergeCandidates", () => {
  beforeEach(() => {
    mockPrisma.order.findMany.mockReset();
  });

  it("exact retailer match, single candidate — returns it", async () => {
    const order = { id: "order_1", userId: "user_1", retailer: "H&M", orderNumber: "H123", status: "ordered" };
    mockPrisma.order.findMany.mockResolvedValueOnce([order]);

    const result = await findShipmentMergeCandidates("user_1", "H&M");

    expect(result).toEqual([order]);
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        retailer: { equals: "H&M", mode: "insensitive" },
        archivedAt: null,
        deletedAt: null,
        status: { in: ["ordered", "shipped", "delivered", "returnable", "needs_review"] },
      },
    });
  });

  it("a second retailer (Poshmark) matches the same way — proves it's not H&M-specific", async () => {
    const order = { id: "order_2", userId: "user_1", retailer: "Poshmark", orderNumber: null, status: "shipped" };
    mockPrisma.order.findMany.mockResolvedValueOnce([order]);

    const result = await findShipmentMergeCandidates("user_1", "Poshmark");

    expect(result).toEqual([order]);
  });

  it("no match at all — returns an empty array, not null, not a throw", async () => {
    mockPrisma.order.findMany.mockResolvedValueOnce([]);

    const result = await findShipmentMergeCandidates("user_1", "Zara");

    expect(result).toEqual([]);
  });

  it("multiple candidates for the same retailer — all returned", async () => {
    const orderA = { id: "order_a", userId: "user_1", retailer: "H&M", orderNumber: "H1", status: "ordered" };
    const orderB = { id: "order_b", userId: "user_1", retailer: "H&M", orderNumber: "H2", status: "returnable" };
    mockPrisma.order.findMany.mockResolvedValueOnce([orderA, orderB]);

    const result = await findShipmentMergeCandidates("user_1", "H&M");

    expect(result).toEqual([orderA, orderB]);
    expect(result).toHaveLength(2);
  });

  it("includes null-orderNumber shell orders as candidates — the only manual recovery path for finding-5 duplicates", async () => {
    const shell = { id: "order_shell", userId: "user_1", retailer: "H&M", orderNumber: null, status: "ordered" };
    mockPrisma.order.findMany.mockResolvedValueOnce([shell]);

    const result = await findShipmentMergeCandidates("user_1", "H&M");

    expect(result).toEqual([shell]);
    expect(result[0].orderNumber).toBeNull();
  });

  it("excludes terminal-state orders via the status filter passed to Prisma — the where clause never asks for returned/refunded/cancelled", async () => {
    mockPrisma.order.findMany.mockResolvedValueOnce([]);

    await findShipmentMergeCandidates("user_1", "H&M");

    const whereArg = mockPrisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.status.in).not.toContain("returned");
    expect(whereArg.status.in).not.toContain("refunded");
    expect(whereArg.status.in).not.toContain("cancelled");
    expect(whereArg.status.in).not.toContain("completed");
    expect(whereArg.status.in).not.toContain("expired");
  });
});


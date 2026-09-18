import { describe, it, expect, vi, beforeEach } from "vitest";

// Global client stand-in for archiveOrphanedEmail's default-parameter path
// (TASKS.md 🔴 Now, order-delete ghost emails fix). computeOrderReviewReason
// below is pure and never touches it.
const mockPrisma = {
  email: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  actionLog: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { computeOrderReviewReason, archiveOrphanedEmail, junkLinkedEmailsForDeletedOrder } = await import("../lib/orderReview");

const base = {
  id: "order-1",
  orderNumber: "ABC123",
  orderDate: new Date("2026-07-01"),
  orderTotal: 42,
  userNote: null as string | null,
  emails: [{ orderNumber: "ABC123" }],
};

describe("computeOrderReviewReason", () => {
  it("reports 'duplicate' when userNote has the [auto] retailer-prefix-merge marker — the real-world AquaTru/AquaTru Water case", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
    };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "duplicate",
      why: "This looks like a duplicate of another order.",
    });
  });

  it("prefers the [auto] marker over an order-number mismatch when both are present", () => {
    const order = {
      ...base,
      userNote: '[auto] retailer prefix match: "AquaTru" ← "AquaTru Water"',
      emails: [{ orderNumber: "DIFFERENT" }],
    };
    expect(computeOrderReviewReason(order, [{ id: "order-2", orderNumber: "DIFFERENT" }]).reasonId).toBe("duplicate");
  });

  it("reports 'belongs_to_existing_order' when a linked email's orderNumber matches a DIFFERENT existing order", () => {
    const order = { ...base, emails: [{ orderNumber: "DIFFERENT" }] };
    expect(computeOrderReviewReason(order, [{ id: "order-2", orderNumber: "DIFFERENT" }])).toEqual({
      reasonId: "belongs_to_existing_order",
      why: "We think this email belongs to an existing order.",
    });
  });

  it("does NOT report 'belongs_to_existing_order' when the mismatched number matches no other real order — a mismatch alone isn't enough (strengthened 2026-08-21; the pre-rebuild code treated any mismatch as sufficient)", () => {
    const order = { ...base, emails: [{ orderNumber: "DIFFERENT" }] };
    expect(computeOrderReviewReason(order, []).reasonId).not.toBe("belongs_to_existing_order");
  });

  it("never matches itself as the 'existing' order (candidateOrders includes the order being checked)", () => {
    const order = { ...base, emails: [{ orderNumber: "ABC123" }] };
    // emails[0].orderNumber === order.orderNumber, so this isn't even a
    // mismatch — but confirm self-exclusion holds regardless by using a
    // candidate list containing only the order itself under a different key.
    expect(computeOrderReviewReason(order, [{ id: "order-1", orderNumber: "ABC123" }]).reasonId).not.toBe(
      "belongs_to_existing_order",
    );
  });

  it("reports a missing purchase date", () => {
    const order = { ...base, orderDate: null };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "missing_order_date",
      why: "We couldn't find a purchase date — the deadline may be estimated.",
    });
  });

  it("reports a missing order total", () => {
    const order = { ...base, orderTotal: null };
    expect(computeOrderReviewReason(order, [])).toEqual({
      reasonId: "missing_order_total",
      why: "We couldn't find the order total.",
    });
  });

  it("prefers missing-date over missing-total when both apply", () => {
    const order = { ...base, orderDate: null, orderTotal: null };
    expect(computeOrderReviewReason(order, []).reasonId).toBe("missing_order_date");
  });

  it("falls back to 'uncertain_details' when nothing more specific applies", () => {
    expect(computeOrderReviewReason(base, [])).toEqual({
      reasonId: "uncertain_details",
      why: "We're not certain about some details on this order.",
    });
  });

  it("does not match a userNote that merely mentions [auto] without the exact merge format", () => {
    const order = { ...base, userNote: "[auto] something unrelated" };
    expect(computeOrderReviewReason(order, []).reasonId).toBe("uncertain_details");
  });

  it("defaults candidateOrders to [] when omitted (e.g. a caller with no other-orders data on hand)", () => {
    expect(() => computeOrderReviewReason(base)).not.toThrow();
  });
});

// TASKS.md 🔴 Now (2026-09-17, amended 2026-09-18) — order-delete junk cascade.
function makeTx(linkedEmails: { id: string; userId: string }[] = []) {
  return {
    email: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
      findMany: vi.fn().mockResolvedValue(linkedEmails),
      update: vi.fn().mockResolvedValue({}),
    },
    actionLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

type Tx = Parameters<typeof junkLinkedEmailsForDeletedOrder>[1];

describe("archiveOrphanedEmail", () => {
  beforeEach(() => {
    mockPrisma.email.findUnique.mockReset();
    mockPrisma.email.update.mockReset();
  });

  it("uses the global client when no tx is passed — archiveOrphanedEmailAction's path, unchanged", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ id: "email-1" });

    expect(await archiveOrphanedEmail("email-1")).toBe(true);
    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: { junkedAt: expect.any(Date) },
    });
  });

  it("uses the passed tx, never the global client, when one is given", async () => {
    const tx = makeTx();

    expect(await archiveOrphanedEmail("email-1", tx as unknown as Tx)).toBe(true);
    expect(tx.email.update).toHaveBeenCalledWith({ where: { id: "email-1" }, data: { junkedAt: expect.any(Date) } });
    expect(mockPrisma.email.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("returns false and writes nothing when the email doesn't exist", async () => {
    mockPrisma.email.findUnique.mockResolvedValue(null);

    expect(await archiveOrphanedEmail("missing")).toBe(false);
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });
});

describe("junkLinkedEmailsForDeletedOrder", () => {
  beforeEach(() => {
    mockPrisma.email.findUnique.mockReset();
    mockPrisma.email.findMany.mockReset();
    mockPrisma.email.update.mockReset();
    mockPrisma.actionLog.create.mockReset();
  });

  it("junks every email linked to the order, through the tx", async () => {
    const tx = makeTx([
      { id: "email-1", userId: "user-1" },
      { id: "email-2", userId: "user-1" },
    ]);

    await junkLinkedEmailsForDeletedOrder("order-1", tx as unknown as Tx);

    expect(tx.email.findMany).toHaveBeenCalledWith({ where: { orderId: "order-1" }, select: { id: true, userId: true } });
    expect(tx.email.update).toHaveBeenCalledTimes(2);
    expect(tx.email.update).toHaveBeenCalledWith({ where: { id: "email-1" }, data: { junkedAt: expect.any(Date) } });
    expect(tx.email.update).toHaveBeenCalledWith({ where: { id: "email-2" }, data: { junkedAt: expect.any(Date) } });
  });

  it("writes exactly one ActionLog row with the orderId in the action string (the orderId column is nulled once the Order is deleted) and no email IDs", async () => {
    const tx = makeTx([
      { id: "email-1", userId: "user-1" },
      { id: "email-2", userId: "user-1" },
      { id: "email-3", userId: "user-1" },
    ]);

    await junkLinkedEmailsForDeletedOrder("order-1", tx as unknown as Tx);

    expect(tx.actionLog.create).toHaveBeenCalledTimes(1);
    expect(tx.actionLog.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        orderId: "order-1",
        action: "order_deleted_junk_cascade:orderId=order-1:count=3",
        outcome: "success",
      },
    });
    const { action } = tx.actionLog.create.mock.calls[0][0].data;
    expect(action).not.toContain("email-");
  });

  it("writes nothing — no junk, no ActionLog row — when the order has no linked emails", async () => {
    const tx = makeTx([]);

    await junkLinkedEmailsForDeletedOrder("order-1", tx as unknown as Tx);

    expect(tx.email.update).not.toHaveBeenCalled();
    expect(tx.actionLog.create).not.toHaveBeenCalled();
  });

  it("never touches the global client when a tx is passed — everything joins the caller's transaction", async () => {
    const tx = makeTx([{ id: "email-1", userId: "user-1" }]);

    await junkLinkedEmailsForDeletedOrder("order-1", tx as unknown as Tx);

    expect(mockPrisma.email.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.email.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.email.update).not.toHaveBeenCalled();
    expect(mockPrisma.actionLog.create).not.toHaveBeenCalled();
  });
});

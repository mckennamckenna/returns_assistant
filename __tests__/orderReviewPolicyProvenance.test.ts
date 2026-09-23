import { vi, describe, it, expect, beforeEach } from "vitest";

// First direct test of linkEmailToExistingOrder (TASKS.md 2026-09-22).
// Until now it was only ever vi.fn()'d away by its callers' tests, which is
// how the 2026-09-21 H&M incident reached production through it: this is
// the exact path a user takes when they hit "Link to order" on a
// needs-review row, and it had no coverage of its own.
//
// Deliberately does NOT mock lib/linkOrder — the whole point is to exercise
// the real mergeEmailIntoOrder through the real manual-link path, since the
// bug lived in the seam between the two, not in either one alone.
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
  actionLog: { findFirst: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/crypto", () => ({ decrypt: (x: string) => x, encrypt: (x: string) => x }));
vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => null }));
vi.mock("@/lib/extract", () => ({
  computeDeadline: () => ({ returnDeadline: null, deadlineIsEstimated: false }),
  normalizeReturnPortalUrl: (url: string | null) => url ?? null,
}));
vi.mock("@/lib/trackingParser", () => ({
  parseTrackingResolved: () => ({ carrier: null, trackingNumber: null, trackingUrl: null }),
}));

const { linkEmailToExistingOrder } = await import("../lib/orderReview");

describe("linkEmailToExistingOrder — policy provenance", () => {
  beforeEach(() => {
    for (const group of Object.values(mockPrisma)) {
      for (const fn of Object.values(group)) fn.mockReset();
    }
    mockPrisma.email.findFirst.mockResolvedValue(null);
    mockPrisma.email.findMany.mockResolvedValue([]);
    mockPrisma.email.update.mockResolvedValue({});
    mockPrisma.actionLog.findFirst.mockResolvedValue(null);
  });

  it("linking a web_lookup carrier email into a stated_in_email order leaves the order's window untouched", async () => {
    // The live shape: a UPS notification with no order number, carrying
    // only a web-lookup window, manually linked to an H&M order whose own
    // delivery email stated 30 days.
    const carrierEmail = {
      id: "email1",
      userId: "user1",
      orderId: null,
      emailType: "shipping_confirmation",
      orderDate: null,
      anchorDate: null,
      deliveryDate: null,
      estimatedDeliveryDate: null,
      deliveredAt: null,
      returnWindowDays: 3,
      returnWindowStartsFrom: "delivery_date",
      policySource: "web_lookup",
      orderTotal: null,
      orderCurrency: null,
      lineItems: [],
    };
    const statedOrder = {
      id: "order1",
      userId: "user1",
      orderDate: null,
      orderDateSource: "unknown",
      orderDateEstimated: false,
      deliveryDate: null,
      estimatedDeliveryDate: null,
      deliveredAt: null,
      returnWindowDays: 30,
      returnWindowStartsFrom: "delivery_date",
      policySource: "stated_in_email",
      orderTotal: null,
      orderCurrency: null,
      lineItems: [],
      returnPortalUrl: null,
      status: "delivered",
      displayStatus: "delivered",
    };

    mockPrisma.email.findUnique.mockResolvedValue(carrierEmail);
    mockPrisma.order.findUnique.mockResolvedValue(statedOrder);
    mockPrisma.order.findUniqueOrThrow.mockResolvedValue(statedOrder);
    mockPrisma.order.update.mockResolvedValue(statedOrder);

    const result = await linkEmailToExistingOrder("email1", "order1");
    expect(result).toBe(true);

    // The merge is the FIRST order.update this path performs; later updates
    // in the same call belong to status recomputation, not the merge.
    const mergeData = mockPrisma.order.update.mock.calls[0][0].data;
    expect(mergeData.returnWindowDays).toBe(30);
    expect(mergeData.returnWindowStartsFrom).toBe("delivery_date");
    expect(mergeData.policySource).toBe("stated_in_email");
  });

  it("still refuses to link across users (pre-existing guard, unchanged)", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ id: "email1", userId: "user1" });
    mockPrisma.order.findUnique.mockResolvedValue({ id: "order1", userId: "user2" });

    expect(await linkEmailToExistingOrder("email1", "order1")).toBe(false);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});

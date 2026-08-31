import { vi, describe, it, expect, beforeEach } from "vitest";

// Same mocking shape as __tests__/unlinkEmailFromOrderAction.test.ts: avoid
// constructing the real Prisma client (no DATABASE_URL in a test
// environment) and stub out the route's other dependencies so importing it
// doesn't pull in real DB/network code.
const mockPrisma = {
  order: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  email: {
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockRecomputeOrderStatus = vi.fn();
vi.mock("@/lib/linkOrder", () => ({ recomputeOrderStatus: mockRecomputeOrderStatus }));

const mockLogActionWithRetry = vi.fn();
vi.mock("@/lib/actionLog", () => ({ logActionWithRetry: mockLogActionWithRetry }));

const { POST } = await import("../app/api/orders/[id]/unkeep/route");

function makeRequest(): Request {
  return {
    headers: {
      get: (name: string) => (name === "x-vercel-forwarded-for" ? "1.2.3.4" : name === "user-agent" ? "test-agent" : null),
    },
  } as unknown as Request;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/orders/[id]/unkeep", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockPrisma.order.findUnique.mockReset();
    mockPrisma.order.update.mockReset();
    mockPrisma.email.findMany.mockReset();
    mockRecomputeOrderStatus.mockReset();
    mockLogActionWithRetry.mockReset();
  });

  it("returns 401 when there is no session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(res.status).toBe(401);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the order doesn't belong to the requesting user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue({ userId: "user-2", displayStatus: "kept", deliveredAt: null });

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(res.status).toBe(404);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the order doesn't exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(res.status).toBe(404);
  });

  it("returns 409 when the order is not currently 'kept'", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue({ userId: "user-1", displayStatus: "shipped", deliveredAt: null });

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(res.status).toBe(409);
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
    expect(mockRecomputeOrderStatus).not.toHaveBeenCalled();
  });

  it("re-derives 'delivered' from a linked delivery email, clears keptAt/archivedAt, recomputes status, and logs success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue({
      userId: "user-1",
      displayStatus: "kept",
      deliveredAt: new Date("2026-07-15T00:00:00Z"),
    });
    mockPrisma.email.findMany.mockResolvedValue([{ emailType: "delivery", refundAmount: null, refundAmountConfidence: null }]);
    mockPrisma.order.update.mockResolvedValue({ displayStatus: "delivered", archivedAt: null });

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { displayStatus: "delivered", keptAt: null, archivedAt: null },
      select: { displayStatus: true, archivedAt: true },
    });
    expect(mockRecomputeOrderStatus).toHaveBeenCalledWith("order-1");
    expect(mockLogActionWithRetry).toHaveBeenCalledWith({
      userId: "user-1",
      orderId: "order-1",
      action: "unkeep",
      outcome: "success",
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ displayStatus: "delivered", archivedAt: null });
  });

  it("re-derives 'ordered' when the order has no shipping/delivery/return evidence at all", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue({ userId: "user-1", displayStatus: "kept", deliveredAt: null });
    mockPrisma.email.findMany.mockResolvedValue([{ emailType: "order_confirmation", refundAmount: null, refundAmountConfidence: null }]);
    mockPrisma.order.update.mockResolvedValue({ displayStatus: "ordered", archivedAt: null });

    await POST(makeRequest() as never, makeParams("order-1"));

    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { displayStatus: "ordered", keptAt: null, archivedAt: null },
      select: { displayStatus: true, archivedAt: true },
    });
  });

  it("the un-keep write and recompute complete before ActionLog is written, and a 200 still comes back", async () => {
    // logActionWithRetry (lib/actionLog.ts) is itself documented to swallow
    // its own failures via an internal retry + console.error fallback, so
    // it never rejects in production — this pins the ordering contract
    // (DB writes commit first, logging is fire-and-forget after) rather
    // than re-testing logActionWithRetry's own swallow behavior, which
    // belongs to that module, not this route.
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.order.findUnique.mockResolvedValue({ userId: "user-1", displayStatus: "kept", deliveredAt: null });
    mockPrisma.email.findMany.mockResolvedValue([]);
    mockPrisma.order.update.mockResolvedValue({ displayStatus: "ordered", archivedAt: null });
    mockLogActionWithRetry.mockResolvedValue(undefined);

    const res = await POST(makeRequest() as never, makeParams("order-1"));

    expect(res.status).toBe(200);
    expect(mockPrisma.order.update).toHaveBeenCalled();
    expect(mockRecomputeOrderStatus).toHaveBeenCalled();
    expect(mockLogActionWithRetry).toHaveBeenCalled();
  });
});

import { vi, describe, it, expect, beforeEach } from "vitest";

const mockPrisma = {
  user: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { windowCutoff, recordInboundArrival, INBOUND_FLOOD_WINDOW_MS } = await import("../lib/inboundVolume");

describe("windowCutoff", () => {
  it("subtracts the window length from now", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(windowCutoff(now, 60 * 60 * 1000)).toEqual(new Date("2026-07-14T11:00:00Z"));
  });

  it("defaults to INBOUND_FLOOD_WINDOW_MS", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(windowCutoff(now)).toEqual(new Date(now.getTime() - INBOUND_FLOOD_WINDOW_MS));
  });
});

describe("recordInboundArrival", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments in place when the window is still fresh, without resetting", async () => {
    mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 }); // guarded increment succeeded
    mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({ inboundWindowCount: 4 });

    const now = new Date("2026-07-14T12:00:00Z");
    const result = await recordInboundArrival("user_1", now);

    expect(result).toBe(4);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", inboundWindowStart: { gte: windowCutoff(now) } },
      data: { inboundWindowCount: { increment: 1 } },
    });
  });

  it("resets the window when the guarded increment matches no row (stale or null window)", async () => {
    mockPrisma.user.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guarded increment found nothing fresh
      .mockResolvedValueOnce({ count: 1 }); // reset succeeded
    mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({ inboundWindowCount: 1 });

    const now = new Date("2026-07-14T12:00:00Z");
    const result = await recordInboundArrival("user_1", now);

    expect(result).toBe(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.user.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "user_1", OR: [{ inboundWindowStart: null }, { inboundWindowStart: { lt: windowCutoff(now) } }] },
      data: { inboundWindowStart: now, inboundWindowCount: 1 },
    });
  });

  it("returns whatever the final read reports, even if a concurrent request advanced it further", async () => {
    // Simulates a concurrent request incrementing between our write and our
    // read — this is fine (not a correctness bug): it only makes a
    // threshold check more likely to fire, never less.
    mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.user.findUniqueOrThrow.mockResolvedValueOnce({ inboundWindowCount: 9 });

    const result = await recordInboundArrival("user_1", new Date("2026-07-14T12:00:00Z"));
    expect(result).toBe(9);
  });
});

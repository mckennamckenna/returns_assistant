import { vi, describe, it, expect, beforeEach } from "vitest";

const mockPrisma = {
  rateLimitCounter: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    upsert: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { rateLimit, rateLimitSweepCutoff, rateLimitSweepWhere, RATE_LIMIT_SWEEP_MAX_AGE_MS } = await import(
  "../lib/rateLimit"
);

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a request under the limit, via the guarded increment path", async () => {
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 1 }); // guarded increment matched
    mockPrisma.rateLimitCounter.findUniqueOrThrow.mockResolvedValueOnce({ count: 3 });

    const result = await rateLimit({ key: "inbound:tok_1", limit: 30, windowSeconds: 3600 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(27);
    expect(mockPrisma.rateLimitCounter.upsert).not.toHaveBeenCalled();
  });

  it("blocks a request once count reaches the limit", async () => {
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.rateLimitCounter.findUniqueOrThrow.mockResolvedValueOnce({ count: 31 });

    const result = await rateLimit({ key: "inbound:tok_1", limit: 30, windowSeconds: 3600 });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("creates a fresh row (count 1, allowed) for a key never seen before", async () => {
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 0 }); // no row for this key+window yet
    mockPrisma.rateLimitCounter.upsert.mockResolvedValueOnce({ count: 1 });

    const result = await rateLimit({ key: "inbound:tok_new", limit: 30, windowSeconds: 3600 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
    expect(mockPrisma.rateLimitCounter.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("resets on window rollover — a stale windowStart doesn't carry its count into the new window", async () => {
    // The guarded updateMany matches on (key, windowStart: currentWindowStart)
    // — an existing row from a previous window has a different windowStart,
    // so it can never match here. count: 0 below simulates exactly that: the
    // row exists but not at this window, so the guarded update touches
    // nothing and the code falls through to the upsert/reset path.
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.rateLimitCounter.upsert.mockResolvedValueOnce({ count: 1 });

    const result = await rateLimit({ key: "inbound:tok_1", limit: 30, windowSeconds: 3600 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29);
    expect(mockPrisma.rateLimitCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "inbound:tok_1" },
        update: expect.objectContaining({ count: 1 }),
        create: expect.objectContaining({ count: 1 }),
      }),
    );
  });

  it("uses the guarded atomic increment, not a read-then-write, so concurrent bursts can't lose a count", async () => {
    // Simulates a concurrent request having already incremented the row
    // between our guarded update and our follow-up read — this is fine (not
    // a correctness bug), same tolerance as lib/inboundVolume.ts: it only
    // makes a block more likely to fire, never less, and it proves the
    // increment itself happened atomically in the DB rather than being
    // computed from a stale in-process read.
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.rateLimitCounter.findUniqueOrThrow.mockResolvedValueOnce({ count: 15 });

    const result = await rateLimit({ key: "inbound:tok_1", limit: 30, windowSeconds: 3600 });

    expect(result.allowed).toBe(true);
    expect(mockPrisma.rateLimitCounter.updateMany).toHaveBeenCalledWith({
      where: { key: "inbound:tok_1", windowStart: expect.any(Date) },
      data: { count: { increment: 1 } },
    });
    expect(mockPrisma.rateLimitCounter.updateMany).toHaveBeenCalledTimes(1);
  });

  it("resetAt lands at the next fixed-window boundary, not a rolling hour from now", async () => {
    mockPrisma.rateLimitCounter.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.rateLimitCounter.findUniqueOrThrow.mockResolvedValueOnce({ count: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:34:56Z"));
    const result = await rateLimit({ key: "inbound:tok_1", limit: 30, windowSeconds: 3600 });
    vi.useRealTimers();

    // 12:34:56 rounds down to the 12:00:00 window boundary; resetAt is one
    // full window later, not "now + 1hr".
    expect(result.resetAt).toEqual(new Date("2026-07-17T13:00:00Z"));
  });
});

describe("rateLimitSweepCutoff / rateLimitSweepWhere", () => {
  it("cuts off 24 hours before now", () => {
    const now = new Date("2026-07-17T12:00:00Z");
    expect(rateLimitSweepCutoff(now)).toEqual(new Date(now.getTime() - RATE_LIMIT_SWEEP_MAX_AGE_MS));
  });

  it("builds a where clause matching rows older than the cutoff", () => {
    const now = new Date("2026-07-17T12:00:00Z");
    expect(rateLimitSweepWhere(now)).toEqual({ windowStart: { lt: rateLimitSweepCutoff(now) } });
  });
});

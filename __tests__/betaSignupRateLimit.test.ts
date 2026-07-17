import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_IP = "203.0.113.7";
const TEST_EMAIL = "prospect@example.com";

// Same in-memory RateLimitCounter stand-in as __tests__/inboundRateLimit.test.ts
// — lets the real (not mocked) lib/rateLimit.ts arithmetic run genuinely
// through the route.
function makeFakeRateLimitTable() {
  const rows = new Map<string, { key: string; windowStart: Date; count: number }>();
  return {
    rows,
    async updateMany({ where, data }: { where: { key: string; windowStart: Date }; data: { count: { increment: number } } }) {
      const row = rows.get(where.key);
      if (!row || row.windowStart.getTime() !== where.windowStart.getTime()) return { count: 0 };
      row.count += data.count.increment;
      return { count: 1 };
    },
    async upsert({
      where,
      update,
    }: {
      where: { key: string };
      update: { windowStart: Date; count: number };
      create: { key: string; windowStart: Date; count: number };
    }) {
      const row = { key: where.key, windowStart: update.windowStart, count: update.count };
      rows.set(where.key, row);
      return row;
    },
    async findUniqueOrThrow({ where }: { where: { key: string } }) {
      const row = rows.get(where.key);
      if (!row) throw new Error("RateLimitCounter row not found");
      return row;
    },
  };
}

let fakeRateLimitTable = makeFakeRateLimitTable();

const mockPrisma = {
  betaSignup: { upsert: vi.fn() },
  get rateLimitCounter() {
    return fakeRateLimitTable;
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockNotifyAdmin = vi.fn();
const mockHasRecentNotification = vi.fn();
const mockRecordDedupedNotification = vi.fn();
vi.mock("@/lib/adminNotify", () => ({
  notifyAdmin: mockNotifyAdmin,
  hasRecentNotification: mockHasRecentNotification,
  recordDedupedNotification: mockRecordDedupedNotification,
}));

const { POST } = await import("../app/api/beta-signup/route");

function makeRequest(ip: string | null = TEST_IP, email: string = TEST_EMAIL): NextRequest {
  const headers: Record<string, string> = {};
  if (ip !== null) headers["x-vercel-forwarded-for"] = ip;
  return new NextRequest("https://myreturnwindow.com/api/beta-signup", {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/beta-signup rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    fakeRateLimitTable = makeFakeRateLimitTable();
    mockPrisma.betaSignup.upsert.mockResolvedValue({ id: "signup_1", email: TEST_EMAIL });
    mockHasRecentNotification.mockResolvedValue(false);
  });

  it("allows the 3rd signup from an IP within the hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 3; i++) {
      const response = await POST(makeRequest());
      expect(response.status).toBe(200);
    }

    vi.useRealTimers();
  });

  it("blocks the 4th signup from the same IP with 429 and a Retry-After header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 3; i++) {
      await POST(makeRequest());
    }
    const upsertCallsAfter3 = mockPrisma.betaSignup.upsert.mock.calls.length;

    const blocked = await POST(makeRequest());

    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // Blocked request never creates a BetaSignup row.
    expect(mockPrisma.betaSignup.upsert.mock.calls.length).toBe(upsertCallsAfter3);

    vi.useRealTimers();
  });

  it("sends no admin notification for the block itself", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 3; i++) {
      await POST(makeRequest());
    }
    mockNotifyAdmin.mockClear();
    mockRecordDedupedNotification.mockClear();

    await POST(makeRequest()); // 4th, blocked

    expect(mockNotifyAdmin).not.toHaveBeenCalled();
    expect(mockRecordDedupedNotification).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("resets after the window rolls over — the next signup from that IP succeeds fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 3; i++) {
      await POST(makeRequest());
    }
    await POST(makeRequest()); // 4th, blocked

    vi.setSystemTime(new Date("2026-07-17T13:00:01Z")); // past the 1hr window
    const afterRollover = await POST(makeRequest());

    expect(afterRollover.status).toBe(200);
    expect(fakeRateLimitTable.rows.get(`beta_signup:${TEST_IP}`)?.count).toBe(1);

    vi.useRealTimers();
  });

  it("rate-limits per IP, not globally — a different IP gets its own budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 3; i++) {
      await POST(makeRequest(TEST_IP));
    }
    await POST(makeRequest(TEST_IP)); // exhausts TEST_IP's budget

    const otherIpResponse = await POST(makeRequest("198.51.100.9"));
    expect(otherIpResponse.status).toBe(200);

    vi.useRealTimers();
  });

  it("falls back to a single 'unknown' bucket when x-vercel-forwarded-for is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    const response = await POST(makeRequest(null));
    expect(response.status).toBe(200);
    expect(fakeRateLimitTable.rows.has("beta_signup:unknown")).toBe(true);

    vi.useRealTimers();
  });

  it("admin gets one email per 24h regardless of how many times the same email signs up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    // First signup from IP A: not yet notified -> notifyAdmin fires.
    mockHasRecentNotification.mockResolvedValueOnce(false).mockResolvedValue(true);

    await POST(makeRequest("198.51.100.1"));
    // Simulate repeat signups (or resubmits) of the same email from
    // different IPs across the day — the IP rate limit wouldn't catch
    // this, which is exactly why the notification needs its own dedup.
    await POST(makeRequest("198.51.100.2"));
    await POST(makeRequest("198.51.100.3"));

    expect(mockNotifyAdmin).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmin).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(TEST_EMAIL), "beta_signup", TEST_EMAIL);
    expect(mockRecordDedupedNotification).toHaveBeenCalledTimes(2);
    expect(mockHasRecentNotification).toHaveBeenCalledWith("beta_signup", TEST_EMAIL);

    vi.useRealTimers();
  });

  it("keys the counter under a beta_signup: prefix, namespaced from other limiters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    await POST(makeRequest());

    expect(Array.from(fakeRateLimitTable.rows.keys())).toEqual([`beta_signup:${TEST_IP}`]);

    vi.useRealTimers();
  });
});

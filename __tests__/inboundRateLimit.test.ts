import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_TOKEN = "tok_abc123";
const TEST_USER = { id: "user_1", email: "test@example.com", inboundToken: TEST_TOKEN };

// A minimal in-memory stand-in for the RateLimitCounter table — implements
// just enough of updateMany/upsert/findUniqueOrThrow's real semantics for
// the actual lib/rateLimit.ts code (not mocked, imported for real below) to
// run genuinely against it. This is what lets these tests exercise the real
// 30-succeed/31st-blocked/window-rollover arithmetic through the route,
// rather than just asserting on a canned mock return value.
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
  user: { findUnique: vi.fn() },
  discardLog: { create: vi.fn() },
  get rateLimitCounter() {
    return fakeRateLimitTable;
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockIsCommerceEmail = vi.fn();
vi.mock("@/lib/classify", () => ({ isCommerceEmail: mockIsCommerceEmail }));

const mockIsGmailForwardingVerification = vi.fn();
vi.mock("@/lib/gmailVerification", () => ({
  isGmailForwardingVerification: mockIsGmailForwardingVerification,
  extractVerificationDetails: vi.fn(),
}));

vi.mock("@/lib/emailEncryption", () => ({
  encryptEmailContent: vi.fn(),
  encryptRawJson: vi.fn(),
}));

const mockNotifyAdmin = vi.fn();
const mockHasRecentNotification = vi.fn();
const mockRecordDedupedNotification = vi.fn();
vi.mock("@/lib/adminNotify", () => ({
  notifyAdmin: mockNotifyAdmin,
  hasRecentNotification: mockHasRecentNotification,
  recordDedupedNotification: mockRecordDedupedNotification,
}));

vi.mock("@/lib/inboundAddress", () => ({ getInboundAddress: vi.fn() }));

const mockRecordInboundArrival = vi.fn();
vi.mock("@/lib/inboundVolume", () => ({
  recordInboundArrival: mockRecordInboundArrival,
  INBOUND_FLOOD_THRESHOLD: 15,
}));

vi.mock("@/lib/runExtraction", () => ({ runExtraction: vi.fn() }));

const { POST } = await import("../app/api/inbound/route");

function makeRequest(): NextRequest {
  return new NextRequest("https://app.myreturnwindow.com/api/inbound", {
    method: "POST",
    body: JSON.stringify({ MailboxHash: TEST_TOKEN, Subject: "Your order shipped", TextBody: "..." }),
  });
}

describe("POST /api/inbound rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    fakeRateLimitTable = makeFakeRateLimitTable();
    mockPrisma.user.findUnique.mockResolvedValue(TEST_USER);
    mockIsCommerceEmail.mockResolvedValue(false); // cheap discard path — no encryption/extraction needed to reach a 200
    mockIsGmailForwardingVerification.mockReturnValue(false);
    mockRecordInboundArrival.mockResolvedValue(1);
    mockHasRecentNotification.mockResolvedValue(false);
  });

  it("allows 30 messages within the hour, all 200", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 30; i++) {
      const response = await POST(makeRequest());
      expect(response.status).toBe(200);
    }

    vi.useRealTimers();
  });

  it("blocks the 31st message with 429 and a Retry-After header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 30; i++) {
      await POST(makeRequest());
    }
    const discardCallsAfter30 = mockPrisma.discardLog.create.mock.calls.length;
    const volumeCallsAfter30 = mockRecordInboundArrival.mock.calls.length;

    const blocked = await POST(makeRequest());

    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    // The blocked request must never reach the discard/processing path, and
    // must never touch the (separate-concern) inbound volume counter.
    expect(mockPrisma.discardLog.create.mock.calls.length).toBe(discardCallsAfter30);
    expect(mockRecordInboundArrival.mock.calls.length).toBe(volumeCallsAfter30);

    vi.useRealTimers();
  });

  it("resets after the window rolls over — next message succeeds fresh at count 1", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 30; i++) {
      await POST(makeRequest());
    }
    await POST(makeRequest()); // 31st, blocked

    vi.setSystemTime(new Date("2026-07-17T13:00:01Z")); // just past the 1hr window boundary
    const afterRollover = await POST(makeRequest());

    expect(afterRollover.status).toBe(200);
    expect(fakeRateLimitTable.rows.get(`inbound:${TEST_TOKEN}`)?.count).toBe(1);

    vi.useRealTimers();
  });

  it("notifies the admin once per token per hour, not once per rejection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 30; i++) {
      await POST(makeRequest());
    }

    // First block: not yet notified this hour -> notifyAdmin fires.
    // Every subsequent block in the same hour: hasRecentNotification now
    // reports true -> only the deduped-record path fires, not a real send.
    mockHasRecentNotification.mockResolvedValueOnce(false).mockResolvedValue(true);

    for (let i = 0; i < 5; i++) {
      const response = await POST(makeRequest());
      expect(response.status).toBe(429);
    }

    expect(mockNotifyAdmin).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdmin).toHaveBeenCalledWith(
      expect.stringContaining(TEST_USER.email),
      expect.any(String),
      "inbound_rate_limited",
      TEST_USER.email,
    );
    expect(mockRecordDedupedNotification).toHaveBeenCalledTimes(4);
    // The dedup check itself uses a 1-hour window, not the 24h default every
    // other notifyAdmin caller uses — confirms this isn't accidentally
    // sharing allowlist_rejection/inbound_volume_spike's cadence.
    expect(mockHasRecentNotification).toHaveBeenCalledWith("inbound_rate_limited", TEST_USER.email, 60 * 60 * 1000);

    vi.useRealTimers();
  });

  it("keys the counter under an inbound: prefix, namespaced from other future users of the shared table", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    await POST(makeRequest());

    const keys = Array.from(fakeRateLimitTable.rows.keys());
    expect(keys).toEqual([`inbound:${TEST_TOKEN}`]);

    vi.useRealTimers();
  });
});

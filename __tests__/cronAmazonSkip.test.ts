import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AMAZON_HANDLING.md's awareness-only principle applied to reminders
// (TASKS.md, 2026-08-04): Amazon orders must not get standalone 7/2/1/
// same-day deadline reminders — visibility comes from the digests only.
// Full-route test (not a pure-function test) because the skip lives inline
// in app/api/cron/route.ts's order loop, same convention as
// __tests__/inboundDedup.test.ts for app/api/inbound/route.ts.

const TEST_SECRET = "a".repeat(64);
const CRON_SECRET = "cron-secret-for-tests";

const mockReminderCreate = vi.fn();
const mockReminderFindUnique = vi.fn().mockResolvedValue(null);
const mockOrderFindMany = vi.fn();

const mockPrisma = {
  order: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: mockOrderFindMany,
  },
  rateLimitCounter: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  reminder: {
    findUnique: mockReminderFindUnique,
    create: mockReminderCreate,
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/postmark", () => ({ sendEmail: mockSendEmail }));

vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: vi.fn() }));

// Refund check-in is a separate reminder type, out of scope for this pass
// (see TASKS.md open question) — stubbed out so this test file only
// exercises the deadline-reminder loop.
const mockRunRefundCheckinReminders = vi.fn().mockResolvedValue({ sent: [], failed: [] });
vi.mock("@/lib/refundCheckin", () => ({ runRefundCheckinReminders: mockRunRefundCheckinReminders }));

// Pure where-clause builders — real implementations are harmless against a
// fully-mocked prisma (their output is just an argument the mock ignores).
vi.mock("@/lib/orderFilters", async () => {
  const real = await vi.importActual<typeof import("../lib/orderFilters")>("../lib/orderFilters");
  return real;
});
vi.mock("@/lib/autoArchive", async () => {
  const real = await vi.importActual<typeof import("../lib/autoArchive")>("../lib/autoArchive");
  return real;
});
vi.mock("@/lib/rateLimit", async () => {
  const real = await vi.importActual<typeof import("../lib/rateLimit")>("../lib/rateLimit");
  return real;
});

const { GET } = await import("../app/api/cron/route");

function makeRequest(force = false): NextRequest {
  const url = force
    ? `https://app.myreturnwindow.com/api/cron?secret=${CRON_SECRET}&force=true`
    : `https://app.myreturnwindow.com/api/cron?secret=${CRON_SECRET}`;
  return new NextRequest(url, { method: "GET" });
}

const TODAY = new Date("2026-08-04T12:00:00.000Z");

function makeOrder(overrides: Partial<{
  id: string;
  retailer: string | null;
  orderNumber: string | null;
  returnDeadline: Date | null;
  status: string;
  displayStatus: string;
  deadlineIsEstimated: boolean;
  orderTotal: number | null;
  orderCurrency: string | null;
  userId: string;
  user: { email: string };
}> = {}) {
  return {
    id: "order_1",
    retailer: "H&M",
    orderNumber: "123",
    // 7 days out from TODAY (2026-08-04) => qualifies for "7_day".
    returnDeadline: new Date("2026-08-11T12:00:00.000Z"),
    status: "returnable",
    displayStatus: "delivered",
    deadlineIsEstimated: false,
    orderTotal: 45,
    orderCurrency: "USD",
    userId: "user_1",
    user: { email: "test@example.com" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("REMINDER_FROM_EMAIL", "reminders@myreturnwindow.com");
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  mockReminderCreate.mockClear();
  mockReminderFindUnique.mockClear().mockResolvedValue(null);
  mockSendEmail.mockClear();
  mockOrderFindMany.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Amazon deadline-reminder suppression", () => {
  it("an Amazon order that would otherwise get a 7_day reminder gets none — no send, no Reminder row", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_amz", retailer: "Amazon" })]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("same Amazon order under ?force=true still gets no reminder — force doesn't bypass the skip", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_amz", retailer: "Amazon" })]);

    const res = await GET(makeRequest(true));
    const body = await res.json();

    expect(body.force).toBe(true);
    expect(body.sent).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("a non-Amazon order that qualifies still gets its reminder — unchanged", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_hm", retailer: "H&M" })]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toHaveLength(1);
    expect(body.sent[0]).toMatchObject({ orderId: "order_hm", reminderType: "7_day" });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockReminderCreate).toHaveBeenCalledWith({
      data: { orderId: "order_hm", userId: "user_1", reminderType: "7_day" },
    });
  });

  it("existing suppression (estimated deadline at the 1_day threshold) is unchanged for a non-Amazon order", async () => {
    mockOrderFindMany.mockResolvedValue([
      makeOrder({
        id: "order_est",
        retailer: "J.Crew",
        returnDeadline: new Date("2026-08-05T12:00:00.000Z"), // 1 day out
        deadlineIsEstimated: true,
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    // suppressForEstimatedDeadline already blocks 1_day/same_day on an
    // estimated deadline — must still hold with the Amazon check added.
    expect(body.sent).toEqual([]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("an Amazon retailer match is case-insensitive and substring-based, same as isAmazonOrder elsewhere", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_amz2", retailer: "amazon.com" })]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toEqual([]);
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("a mixed batch skips only the Amazon order, still sends the non-Amazon one", async () => {
    mockOrderFindMany.mockResolvedValue([
      makeOrder({ id: "order_amz", retailer: "Amazon" }),
      makeOrder({ id: "order_hm", retailer: "H&M" }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toHaveLength(1);
    expect(body.sent[0].orderId).toBe("order_hm");
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockReminderCreate).toHaveBeenCalledTimes(1);
  });
});

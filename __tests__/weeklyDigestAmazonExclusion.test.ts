import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// DECISIONS.md 2026-08-10: the Sunday returns digest excludes Amazon from
// its "due this week" content (strict isAmazonOrder match), on both the
// normal and ?force=true paths, since both flow through the same content
// query. Full-route test (not pure-function-only) because the filter lives
// inline in app/api/cron/weekly-digest/route.ts's content query, same
// convention as __tests__/cronAmazonSkip.test.ts for app/api/cron/route.ts.
// Empty-after-filter weeks must still send — no skip-empty behavior.

const TEST_SECRET = "a".repeat(64);
const CRON_SECRET = "cron-secret-for-tests";

const mockOrderFindMany = vi.fn();
const mockUserFindMany = vi.fn();
const mockReminderFindFirst = vi.fn().mockResolvedValue(null);
const mockReminderCreate = vi.fn();

const mockPrisma = {
  user: { findMany: mockUserFindMany },
  order: { findMany: mockOrderFindMany },
  reminder: { findFirst: mockReminderFindFirst, create: mockReminderCreate },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/postmark", () => ({ sendEmail: mockSendEmail }));

vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: vi.fn() }));

const { GET } = await import("../app/api/cron/weekly-digest/route");

function makeRequest(force = false): NextRequest {
  const url = force
    ? `https://app.myreturnwindow.com/api/cron/weekly-digest?secret=${CRON_SECRET}&force=true`
    : `https://app.myreturnwindow.com/api/cron/weekly-digest?secret=${CRON_SECRET}`;
  return new NextRequest(url, { method: "GET" });
}

const TODAY = new Date("2026-08-09T12:00:00.000Z"); // Sunday

function makeOrder(overrides: Partial<{
  id: string;
  retailer: string | null;
  orderNumber: string | null;
  returnDeadline: Date | null;
  displayStatus: string;
}> = {}) {
  return {
    id: "order_1",
    retailer: "H&M",
    orderNumber: "123",
    returnDeadline: new Date("2026-08-12T12:00:00.000Z"), // within the 7-day window
    displayStatus: "shipped",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("REMINDER_FROM_EMAIL", "reminders@myreturnwindow.com");
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  mockUserFindMany.mockResolvedValue([{ id: "user_1", email: "test@example.com" }]);
  mockOrderFindMany.mockReset();
  mockReminderFindFirst.mockClear().mockResolvedValue(null);
  mockReminderCreate.mockClear();
  mockSendEmail.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("weekly digest — Amazon exclusion", () => {
  it("an Amazon order is excluded from the digest content", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_amz", retailer: "Amazon" })]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toHaveLength(1);
    expect(body.sent[0].orderCount).toBe(0);
    const sentText: string = mockSendEmail.mock.calls[0][0].textBody;
    expect(sentText).not.toContain("Amazon");
    expect(sentText).toContain("Nothing due this week");
  });

  it("a non-Amazon order is retained", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_hm", retailer: "H&M" })]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const sentText: string = mockSendEmail.mock.calls[0][0].textBody;
    expect(sentText).toContain("H&M");
  });

  it("the Amazon order is also excluded on the ?force=true path", async () => {
    mockOrderFindMany.mockResolvedValue([makeOrder({ id: "order_amz", retailer: "amazon.com" })]);

    const res = await GET(makeRequest(true));
    const body = await res.json();

    expect(body.force).toBe(true);
    expect(body.sent[0].orderCount).toBe(0);
    const sentText: string = mockSendEmail.mock.calls[0][0].textBody;
    expect(sentText).not.toContain("Amazon");
    // force sends must never write a dedup Reminder row, unrelated to this
    // filter but load-bearing per the existing comment in the route.
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("a mixed batch drops only the Amazon row", async () => {
    mockOrderFindMany.mockResolvedValue([
      makeOrder({ id: "order_amz", retailer: "Amazon" }),
      makeOrder({ id: "order_hm", retailer: "H&M" }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const sentText: string = mockSendEmail.mock.calls[0][0].textBody;
    expect(sentText).toContain("H&M");
    expect(sentText).not.toContain("Amazon");
  });

  it("an all-Amazon week still sends the digest (weekly touchpoint retained, no skip-empty)", async () => {
    mockOrderFindMany.mockResolvedValue([
      makeOrder({ id: "order_amz1", retailer: "Amazon" }),
      makeOrder({ id: "order_amz2", retailer: "amazon.com" }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent).toHaveLength(1);
    expect(body.sent[0].orderCount).toBe(0);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sentText: string = mockSendEmail.mock.calls[0][0].textBody;
    expect(sentText).toContain("Nothing due this week");
    expect(mockReminderCreate).toHaveBeenCalledTimes(1);
  });
});

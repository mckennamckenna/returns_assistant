import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Coverage-check "this week" fix (TASKS.md 🔴 Now, 2026-08-05): a linked
// order now appears only if the ORDER itself was placed within the rolling
// 7-day content window (Order.orderDate), not because some email about it
// (e.g. a delivery notice) merely arrived this week. Unlinked emails are
// unchanged — still keyed on receivedAt, since they're the missing-order
// signal this email exists to surface. Full-route test (not a pure-function
// test) because the filter lives inline in the order loop, same convention
// as __tests__/cronAmazonSkip.test.ts for app/api/cron/route.ts.

const CRON_SECRET = "cron-secret-for-tests";

const mockUserFindMany = vi.fn();
const mockReminderFindFirst = vi.fn();
const mockReminderCreate = vi.fn();
const mockEmailFindMany = vi.fn();

const mockPrisma = {
  user: { findMany: mockUserFindMany },
  reminder: { findFirst: mockReminderFindFirst, create: mockReminderCreate },
  email: { findMany: mockEmailFindMany },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/postmark", () => ({ sendEmail: mockSendEmail }));

const mockNotifyAdmin = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: mockNotifyAdmin }));

const { GET } = await import("../app/api/cron/weekly-coverage/route");

function makeRequest(force = false): NextRequest {
  const url = force
    ? `https://app.myreturnwindow.com/api/cron/weekly-coverage?secret=${CRON_SECRET}&force=true`
    : `https://app.myreturnwindow.com/api/cron/weekly-coverage?secret=${CRON_SECRET}`;
  return new NextRequest(url, { method: "GET" });
}

// Friday 16:00 UTC — matches COVERAGE_CHECK_CRON_DAY_UTC/HOUR_UTC, so
// scheduledRunWeekStart(NOW) === NOW and dedup math is trivial to reason
// about in these tests.
const NOW = new Date("2026-08-07T16:00:00.000Z");
// Content window: rolling 7 days back from NOW.
const THIS_WEEK = new Date("2026-08-03T12:00:00.000Z"); // inside the window
const THREE_WEEKS_AGO = new Date("2026-07-17T12:00:00.000Z"); // outside the window

const USER = { id: "user_1", email: "test@example.com", name: "Alex" };

function makeEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: "email_1",
    orderId: null,
    receivedAt: THIS_WEEK,
    retailer: "Some Retailer",
    junkedAt: null,
    order: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("REMINDER_FROM_EMAIL", "reminders@myreturnwindow.com");
  vi.stubEnv("ALPHA_MODE", "true");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockUserFindMany.mockReset().mockResolvedValue([USER]);
  mockReminderFindFirst.mockReset().mockResolvedValue(null);
  mockReminderCreate.mockReset();
  mockEmailFindMany.mockReset();
  mockSendEmail.mockClear();
  mockNotifyAdmin.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// Every fixture below that represents a real purchase carries a non-empty
// `emails` array on its `order` object — the establishing-email gate
// (2026-08-16) now requires it. `HAS_ESTABLISHING` is deliberately opaque
// (id only) since the gate only checks presence, not content.
const HAS_ESTABLISHING = [{ id: "establishing_email_1" }];

describe("weekly coverage-check — linked orders filtered by placedDate, not triggering email", () => {
  it("1. a linked order placed this week is included", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({
        orderId: "order_1",
        receivedAt: THIS_WEEK,
        order: { retailer: "Emme Parsons", orderTotal: 40, orderCurrency: "USD", orderDate: THIS_WEEK, emails: HAS_ESTABLISHING },
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).toContain("Emme Parsons");
  });

  it("2. a linked order placed 3 weeks ago, only a delivery email this week, is EXCLUDED (the core fix)", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({
        orderId: "order_emme",
        receivedAt: THIS_WEEK, // the delivery notice arrived this week...
        order: {
          retailer: "Emme Parsons",
          orderTotal: 40,
          orderCurrency: "USD",
          orderDate: THREE_WEEKS_AGO, // ...but the order itself was placed weeks ago
          emails: HAS_ESTABLISHING, // clears the establishing gate — this test isolates the staleness check alone
        },
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(0);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).not.toContain("Emme Parsons");
    expect(textBody).toContain("We didn't receive any shopping emails from you this week.");
  });

  it("3. a linked order placed this week with confirmation + shipping emails both this week still dedupes to one line", async () => {
    const order = { retailer: "Mejuri", orderTotal: 80, orderCurrency: "USD", orderDate: THIS_WEEK, emails: HAS_ESTABLISHING };
    mockEmailFindMany.mockResolvedValue([
      makeEmail({ id: "email_conf", orderId: "order_mejuri", receivedAt: THIS_WEEK, order }),
      makeEmail({ id: "email_ship", orderId: "order_mejuri", receivedAt: THIS_WEEK, order }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody.match(/Mejuri/g)?.length).toBe(1);
  });

  it("4. an unlinked email received this week is still included — the missing-order candidate this email exists to surface", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({ orderId: null, receivedAt: THIS_WEEK, retailer: "SilkSilky", order: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).toContain("SilkSilky");
  });

  it("5. a linked order whose placedDate is indeterminate (orderDate null) but WITH a real establishing email is included, not silently dropped", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({
        orderId: "order_indeterminate",
        receivedAt: THIS_WEEK,
        order: { retailer: "Good Eggs", orderTotal: null, orderCurrency: null, orderDate: null, emails: HAS_ESTABLISHING },
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).toContain("Good Eggs");
  });

  it("5b. a linked order with NO establishing email anywhere is dropped, even though orderDate is null (the #2523415500 orphan class) — NEW 2026-08-16", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({
        orderId: "order_orphan_refund",
        receivedAt: THIS_WEEK,
        order: { retailer: "J.Crew", orderTotal: 350.65, orderCurrency: "USD", orderDate: null, emails: [] },
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(0);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).not.toContain("J.Crew");
    expect(textBody).toContain("We didn't receive any shopping emails from you this week.");
  });

  it("5c. an extraction-failure row (emailType: null, unlinked) is still included — the QA net's job, unaffected by the establishing gate — NEW 2026-08-16", async () => {
    mockEmailFindMany.mockResolvedValue([
      makeEmail({ orderId: null, receivedAt: THIS_WEEK, retailer: null, order: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.sent[0].orderCount).toBe(1);
    const textBody = mockSendEmail.mock.calls[0][0].textBody as string;
    expect(textBody).toContain("an unknown retailer");
  });

  it("6a. dedup: a user already sent this scheduled week is skipped, no send, no new Reminder row", async () => {
    mockReminderFindFirst.mockResolvedValue({ id: "reminder_prev" });
    mockEmailFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.skippedAlreadySent).toEqual([{ userId: USER.id, userEmail: USER.email }]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });

  it("6b. ?force=true bypasses the dedup skip and sends, but never writes a Reminder row", async () => {
    mockReminderFindFirst.mockResolvedValue({ id: "reminder_prev" }); // would normally suppress
    mockEmailFindMany.mockResolvedValue([
      makeEmail({
        orderId: "order_1",
        receivedAt: THIS_WEEK,
        order: { retailer: "Emme Parsons", orderTotal: 40, orderCurrency: "USD", orderDate: THIS_WEEK, emails: HAS_ESTABLISHING },
      }),
    ]);

    const res = await GET(makeRequest(true));
    const body = await res.json();

    expect(body.force).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(body.sent).toHaveLength(1);
    expect(mockReminderCreate).not.toHaveBeenCalled();
  });
});

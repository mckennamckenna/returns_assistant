import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Exercises the REAL lib/adminNotify.ts (notifyAdmin, hasRecentNotification,
// recordDedupedNotification) through the beta-signup route — unlike
// __tests__/betaSignupRateLimit.test.ts, which mocks adminNotify's exports
// directly. That's the right boundary for testing the route's wiring, but
// it can't prove whether the dedup itself is scoped per-kind or per-email —
// these tests exist specifically to make that distinction explicit and
// regression-proof (see the Decisions log entry on dedup granularity).

const ADMIN_EMAIL = "admin@example.com";
const FROM_EMAIL = "reminders@example.com";

function makeFakeAdminNotificationTable() {
  const rows: { kind: string; relatedEmail: string | null; attemptedAt: Date }[] = [];
  return {
    rows,
    async create({ data }: { data: { kind: string; relatedEmail: string | null } }) {
      const row = { kind: data.kind, relatedEmail: data.relatedEmail, attemptedAt: new Date() };
      rows.push(row);
      return row;
    },
    async findFirst({
      where,
    }: {
      where: { kind: string; relatedEmail: string; attemptedAt: { gte: Date } };
    }) {
      return (
        rows.find(
          (r) => r.kind === where.kind && r.relatedEmail === where.relatedEmail && r.attemptedAt.getTime() >= where.attemptedAt.gte.getTime(),
        ) ?? null
      );
    },
  };
}

// Same minimal RateLimitCounter fake used elsewhere — the route always
// checks the rate limit first, but these tests are about the notification
// dedup, so every call below uses a distinct IP to stay under the 3/hr
// limit rather than re-testing the limiter itself.
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

let fakeAdminNotificationTable = makeFakeAdminNotificationTable();
let fakeRateLimitTable = makeFakeRateLimitTable();

const mockPrisma = {
  betaSignup: { upsert: vi.fn().mockResolvedValue({ id: "signup_1" }) },
  get adminNotification() {
    return fakeAdminNotificationTable;
  },
  get rateLimitCounter() {
    return fakeRateLimitTable;
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.fn();
vi.mock("@/lib/postmark", () => ({ sendEmail: mockSendEmail }));

const { POST } = await import("../app/api/beta-signup/route");

let nextIp = 1;
function makeRequest(email: string): NextRequest {
  const ip = `198.51.100.${nextIp++}`; // fresh IP per call, isolates from the rate limiter
  return new NextRequest("https://myreturnwindow.com/api/beta-signup", {
    method: "POST",
    headers: { "x-vercel-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/beta-signup — admin notification dedup granularity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    fakeAdminNotificationTable = makeFakeAdminNotificationTable();
    fakeRateLimitTable = makeFakeRateLimitTable();
    nextIp = 1;
    mockPrisma.betaSignup.upsert.mockResolvedValue({ id: "signup_1" });
    mockSendEmail.mockResolvedValue(undefined);
    vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
    vi.stubEnv("REMINDER_FROM_EMAIL", FROM_EMAIL);
  });

  it("dedups per email, not per kind: the same email submitted 4 times in 24h sends exactly one admin email", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 4; i++) {
      const response = await POST(makeRequest("repeat@example.com"));
      expect(response.status).toBe(200);
    }

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ADMIN_EMAIL, textBody: expect.stringContaining("repeat@example.com") }));

    vi.useRealTimers();
  });

  it("does not collapse across different emails: two distinct signups within 24h each send their own admin email", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    await POST(makeRequest("first@example.com"));
    await POST(makeRequest("second@example.com"));

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ textBody: expect.stringContaining("first@example.com") }));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ textBody: expect.stringContaining("second@example.com") }));

    vi.useRealTimers();
  });

  it("fires again for the same email once the 24h window has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    await POST(makeRequest("returning@example.com"));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-18T12:00:01Z")); // just past the 24h window
    await POST(makeRequest("returning@example.com"));

    expect(mockSendEmail).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

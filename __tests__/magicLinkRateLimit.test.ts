import { vi, describe, it, expect, beforeEach } from "vitest";

const ADMIN_EMAIL = "admin@example.com";
const FROM_EMAIL = "reminders@example.com";
const ALLOWLISTED_EMAIL = "real-user@example.com";
const UNKNOWN_EMAIL = "prober@example.com";

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

let fakeRateLimitTable = makeFakeRateLimitTable();
let fakeAdminNotificationTable = makeFakeAdminNotificationTable();

const mockPrisma = {
  user: { findUnique: vi.fn() },
  allowedSignIn: { findUnique: vi.fn() },
  get rateLimitCounter() {
    return fakeRateLimitTable;
  },
  get adminNotification() {
    return fakeAdminNotificationTable;
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.fn();
vi.mock("@/lib/postmark", () => ({ sendEmail: mockSendEmail }));

const { sendVerificationRequest, MagicLinkRateLimitError, buildSignInEmailPayload, buildSignInAdminNotification } = await import(
  "../lib/magicLinkRateLimit"
);

function sendCallsTo(recipient: string) {
  return mockSendEmail.mock.calls.filter((call) => call[0].to === recipient);
}

// Rate-limit-hit and sign-in-sent notifications both go `to: ADMIN_EMAIL`;
// tests that care specifically about the rate-limit notification (not the
// new per-successful-send one added for M1) filter on this instead of just
// recipient.
function adminCallsWithSubjectContaining(fragment: string) {
  return sendCallsTo(ADMIN_EMAIL).filter((call) => call[0].subject?.includes(fragment));
}

function makeRequest(ip: string): Request {
  return new Request("https://app.myreturnwindow.com/api/auth/callback/nodemailer", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

let nextIp = 1;
function freshIp(): string {
  return `198.51.100.${nextIp++}`;
}

async function send(email: string, ip: string = freshIp()) {
  return sendVerificationRequest({ identifier: email, url: "https://app.myreturnwindow.com/callback", request: makeRequest(ip) });
}

function resetMocks() {
  vi.clearAllMocks();
  vi.useRealTimers();
  fakeRateLimitTable = makeFakeRateLimitTable();
  fakeAdminNotificationTable = makeFakeAdminNotificationTable();
  nextIp = 1;
  mockSendEmail.mockResolvedValue(undefined);
  vi.stubEnv("ADMIN_EMAIL", ADMIN_EMAIL);
  vi.stubEnv("REMINDER_FROM_EMAIL", FROM_EMAIL);
  vi.stubEnv("LOGIN_FROM_EMAIL", FROM_EMAIL);

  mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
    where.email === ALLOWLISTED_EMAIL ? { id: "user_1", email: ALLOWLISTED_EMAIL } : null,
  );
  mockPrisma.allowedSignIn.findUnique.mockResolvedValue(null);
}

describe("auth.ts sendVerificationRequest rate limiting", () => {
  beforeEach(resetMocks);

  it("allows 8 sends to the same email within the hour, all trigger delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 8; i++) {
      await send(ALLOWLISTED_EMAIL);
    }

    expect(sendCallsTo(ALLOWLISTED_EMAIL)).toHaveLength(8);

    vi.useRealTimers();
  });

  it("blocks the 9th send to the same email with MagicLinkRateLimitError", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 8; i++) {
      await send(ALLOWLISTED_EMAIL);
    }

    await expect(send(ALLOWLISTED_EMAIL)).rejects.toThrow(MagicLinkRateLimitError);
    expect(sendCallsTo(ALLOWLISTED_EMAIL)).toHaveLength(8); // no 9th delivery

    vi.useRealTimers();
  });

  it("allows 20 sends from one IP across different emails, all trigger delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_1" }); // every email in this test is "allowlisted" via existing user

    const ip = "203.0.113.50";
    for (let i = 0; i < 20; i++) {
      await send(`user${i}@example.com`, ip);
    }

    // Excludes ADMIN_EMAIL, which also matches "@example.com" and — since
    // every one of these 20 sends is to an allowlisted address — now also
    // triggers its own magic_link_sent admin notification (M1 fix).
    expect(mockSendEmail.mock.calls.filter((call) => call[0].to?.includes("@example.com") && call[0].to !== ADMIN_EMAIL)).toHaveLength(20);

    vi.useRealTimers();
  });

  it("blocks the 21st send from the same IP even with a fresh, under-limit email", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user_1" });

    const ip = "203.0.113.51";
    for (let i = 0; i < 20; i++) {
      await send(`user${i}@example.com`, ip);
    }

    await expect(send("user20@example.com", ip)).rejects.toThrow(MagicLinkRateLimitError);

    vi.useRealTimers();
  });

  it("resets after the window rolls over — the next send succeeds fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 8; i++) {
      await send(ALLOWLISTED_EMAIL);
    }
    await expect(send(ALLOWLISTED_EMAIL)).rejects.toThrow(MagicLinkRateLimitError);

    vi.setSystemTime(new Date("2026-07-17T13:00:01Z")); // past the 1hr window
    await send(ALLOWLISTED_EMAIL);

    expect(sendCallsTo(ALLOWLISTED_EMAIL)).toHaveLength(9); // 8 + the fresh one after rollover
    expect(fakeRateLimitTable.rows.get(`magic_link_email:${ALLOWLISTED_EMAIL}`)?.count).toBe(1);

    vi.useRealTimers();
  });

  it("notifies the admin once per email per 24h across repeated blocks, not once per block", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 8; i++) {
      await send(ALLOWLISTED_EMAIL);
    }
    for (let i = 0; i < 5; i++) {
      await expect(send(ALLOWLISTED_EMAIL)).rejects.toThrow(MagicLinkRateLimitError);
    }

    // The 8 successful sends before the block each also fire their own
    // magic_link_sent admin notification (M1 fix) — this test is only
    // about the rate-limit-hit notification staying deduped to 1.
    expect(adminCallsWithSubjectContaining("Magic-link rate limit")).toHaveLength(1);

    vi.useRealTimers();
  });

  it("does not send a magic_link_rate_limited notification when a non-allowlisted email hits the limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
    // UNKNOWN_EMAIL: findUnique mock (from beforeEach) returns null for
    // anything but ALLOWLISTED_EMAIL, and allowedSignIn is stubbed null too.
    // Each of the 8 under-limit sends below still fires the pre-existing,
    // unrelated allowlist_rejection notification (deduped after the
    // first) — untouched existing behavior, not what this test is about.
    // This test only asserts on the new magic_link_rate_limited kind.

    for (let i = 0; i < 8; i++) {
      await send(UNKNOWN_EMAIL);
    }
    await expect(send(UNKNOWN_EMAIL)).rejects.toThrow(MagicLinkRateLimitError);

    const adminCalls = sendCallsTo(ADMIN_EMAIL);
    expect(adminCalls.every((call) => !call[0].subject?.includes("Magic-link rate limit"))).toBe(true);

    vi.useRealTimers();
  });

  it("includes which limit was hit (email vs. IP) in the admin notification body", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    for (let i = 0; i < 8; i++) {
      await send(ALLOWLISTED_EMAIL);
    }
    await expect(send(ALLOWLISTED_EMAIL)).rejects.toThrow(MagicLinkRateLimitError);

    const [adminCall] = adminCallsWithSubjectContaining("Magic-link rate limit");
    expect(adminCall[0].textBody).toContain("per-email limit");

    vi.useRealTimers();
  });

  it("keys the counters under magic_link_email: and magic_link_ip: prefixes, distinct from inbound: and beta_signup:", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));

    await send(ALLOWLISTED_EMAIL, "203.0.113.99");

    const keys = Array.from(fakeRateLimitTable.rows.keys());
    expect(keys).toContain(`magic_link_email:${ALLOWLISTED_EMAIL}`);
    expect(keys).toContain("magic_link_ip:203.0.113.99");
    expect(keys.some((k) => k.startsWith("inbound:") || k.startsWith("beta_signup:"))).toBe(false);

    vi.useRealTimers();
  });
});

describe("M1 fix — sign-in email no longer bcc's the admin with a live link", () => {
  beforeEach(resetMocks);

  const TEST_URL = "https://app.myreturnwindow.com/api/auth/callback/nodemailer?token=SECRET_TOKEN_VALUE";

  it("buildSignInEmailPayload never includes a bcc field", () => {
    const payload = buildSignInEmailPayload({ to: ALLOWLISTED_EMAIL, from: FROM_EMAIL, url: TEST_URL });
    expect(payload).not.toHaveProperty("bcc");
    expect(Object.keys(payload)).toEqual(["to", "from", "subject", "textBody"]);
  });

  it("buildSignInAdminNotification never includes the url/token", () => {
    const { subject, body } = buildSignInAdminNotification({ email: ALLOWLISTED_EMAIL, signedInAt: new Date("2026-07-18T12:00:00Z") });
    expect(subject).not.toContain(TEST_URL);
    expect(body).not.toContain(TEST_URL);
    expect(body).not.toContain("SECRET_TOKEN_VALUE");
    expect(body).not.toContain("http");
  });

  it("buildSignInAdminNotification identifies who signed in and when", () => {
    const { subject, body } = buildSignInAdminNotification({ email: ALLOWLISTED_EMAIL, signedInAt: new Date("2026-07-18T12:00:00Z") });
    expect(subject).toContain(ALLOWLISTED_EMAIL);
    expect(body).toContain(ALLOWLISTED_EMAIL);
    expect(body).toContain("2026-07-18T12:00:00.000Z");
  });

  it("a successful send delivers a bcc-free email to the user and a separate link-free notification to the admin", async () => {
    await sendVerificationRequest({ identifier: ALLOWLISTED_EMAIL, url: TEST_URL, request: makeRequest(freshIp()) });

    const [userCall] = sendCallsTo(ALLOWLISTED_EMAIL);
    expect(userCall[0]).not.toHaveProperty("bcc");
    expect(userCall[0].textBody).toContain(TEST_URL); // the real recipient still gets the real link

    const adminCalls = adminCallsWithSubjectContaining("Sign-in link sent");
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0][0].textBody).not.toContain(TEST_URL);
    expect(adminCalls[0][0].textBody).not.toContain("SECRET_TOKEN_VALUE");
    expect(adminCalls[0][0].textBody).toContain(ALLOWLISTED_EMAIL);
  });

  it("a non-allowlisted email never triggers a magic_link_sent notification", async () => {
    await sendVerificationRequest({ identifier: UNKNOWN_EMAIL, url: TEST_URL, request: makeRequest(freshIp()) });

    expect(sendCallsTo(UNKNOWN_EMAIL)).toHaveLength(0); // silent skip, unchanged existing behavior
    expect(adminCallsWithSubjectContaining("Sign-in link sent")).toHaveLength(0);
  });
});

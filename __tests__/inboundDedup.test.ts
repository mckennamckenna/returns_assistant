import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ANCHOR_DATE_RESOLVER.md dedup guard (2026-07-26): Postmark redelivering
// the same message must not become a second Email row. Real fixture: ACE
// VISALIA RSC (×6) / GLOBAL-E NL B.V (×3), confirmed genuine redeliveries
// via MessageID + subject + htmlBody hash — not distinct emails.

const TEST_TOKEN = "tok_abc123";
const TEST_USER = { id: "user_1", email: "test@example.com", inboundToken: TEST_TOKEN };
const OTHER_USER = { id: "user_2", email: "other@example.com", inboundToken: "tok_other" };

// Stateful in-memory Email table -- findFirst/create interact for real, so
// "does a second delivery get skipped" is exercised end to end rather than
// asserted against a canned mock return.
function makeFakeEmailTable() {
  const rows: { id: string; userId: string; messageId: string | null }[] = [];
  let nextId = 1;
  return {
    rows,
    async findFirst({ where }: { where: { userId: string; messageId: string } }) {
      return rows.find((r) => r.userId === where.userId && r.messageId === where.messageId) ?? null;
    },
    async create({ data }: { data: { userId: string; messageId?: string | null } }) {
      // Mirrors the real @@unique([userId, messageId]) constraint -- null
      // messageId never collides with itself, same as Postgres semantics.
      if (data.messageId != null && rows.some((r) => r.userId === data.userId && r.messageId === data.messageId)) {
        const err = new Error("Unique constraint failed on the fields: (`userId`,`messageId`)") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row = { id: `email_${nextId++}`, userId: data.userId, messageId: data.messageId ?? null };
      rows.push(row);
      return row;
    },
  };
}

let fakeEmailTable = makeFakeEmailTable();

const mockPrisma = {
  user: { findUnique: vi.fn() },
  discardLog: { create: vi.fn() },
  get email() {
    return fakeEmailTable;
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockIsCommerceEmail = vi.fn();
vi.mock("@/lib/classify", () => ({ isCommerceEmail: mockIsCommerceEmail }));

vi.mock("@/lib/gmailVerification", () => ({
  isGmailForwardingVerification: () => false,
  extractVerificationDetails: vi.fn(),
}));

vi.mock("@/lib/emailEncryption", () => ({
  encryptEmailContent: () => ({ fromEmail: "enc", fromName: null, textBody: "enc", htmlBody: "enc" }),
  encryptRawJson: () => "enc-raw",
}));

vi.mock("@/lib/adminNotify", () => ({
  notifyAdmin: vi.fn(),
  hasRecentNotification: vi.fn().mockResolvedValue(false),
  recordDedupedNotification: vi.fn(),
}));

vi.mock("@/lib/inboundAddress", () => ({ getInboundAddress: vi.fn() }));

vi.mock("@/lib/inboundVolume", () => ({
  recordInboundArrival: vi.fn().mockResolvedValue(1),
  INBOUND_FLOOD_THRESHOLD: 15,
}));

// Real rate limiting isn't under test here -- always allow.
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: new Date() }),
}));

vi.mock("@/lib/forwardResolver", () => ({
  classifyForwardType: () => "manual",
  resolveAnchorDate: () => ({ anchorDate: null, anchorSource: "unresolved" }),
}));

vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => "body" }));

const mockRunExtraction = vi.fn();
vi.mock("@/lib/runExtraction", () => ({ runExtraction: mockRunExtraction }));

const { POST } = await import("../app/api/inbound/route");

function makeRequest(overrides: Record<string, unknown> = {}, mailboxHash = TEST_TOKEN): NextRequest {
  return new NextRequest("https://app.myreturnwindow.com/api/inbound", {
    method: "POST",
    body: JSON.stringify({
      MailboxHash: mailboxHash,
      Subject: "Your order shipped",
      TextBody: "...",
      MessageID: "msg-abc-123",
      ...overrides,
    }),
  });
}

describe("POST /api/inbound MessageID dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeEmailTable = makeFakeEmailTable();
    mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { inboundToken: string } }) =>
      where.inboundToken === TEST_USER.inboundToken ? TEST_USER : where.inboundToken === OTHER_USER.inboundToken ? OTHER_USER : null,
    );
    mockIsCommerceEmail.mockResolvedValue(true);
  });

  it("creates the row and runs extraction on first delivery", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(fakeEmailTable.rows[0].messageId).toBe("msg-abc-123");
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalled();
  });

  it("discards a redelivery of the same MessageID for the same user -- the ACE VISALIA/GLOBAL-E case", async () => {
    await POST(makeRequest());
    mockRunExtraction.mockClear();

    const second = await POST(makeRequest());

    expect(second.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1); // no second row created
    expect(mockRunExtraction).not.toHaveBeenCalled();
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "duplicate_messageid" } });
  });

  it("does NOT discard the same MessageID for a DIFFERENT user -- scoped to (userId, messageId), not global", async () => {
    await POST(makeRequest());
    mockRunExtraction.mockClear();

    const fromOtherUser = await POST(makeRequest({}, OTHER_USER.inboundToken));

    expect(fromOtherUser.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(2);
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalled();
  });

  it("skips the dedup check entirely when the payload has no MessageID -- proceeds normally, never calls findFirst", async () => {
    const findFirstSpy = vi.spyOn(fakeEmailTable, "findFirst");

    const response = await POST(makeRequest({ MessageID: undefined }));

    expect(response.status).toBe(200);
    expect(findFirstSpy).not.toHaveBeenCalled();
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(fakeEmailTable.rows[0].messageId).toBeNull();
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });

  it("race backstop: a P2002 from create() is treated as a duplicate, not a failure", async () => {
    // Simulates two near-simultaneous redeliveries both passing the
    // findFirst check before either has written its row.
    fakeEmailTable.findFirst = async () => null;
    fakeEmailTable.create = async () => {
      const err = new Error("Unique constraint failed") as Error & { code: string };
      err.code = "P2002";
      throw err;
    };

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mockRunExtraction).not.toHaveBeenCalled();
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "duplicate_messageid" } });
  });

  it("a non-P2002 create() error is NOT treated as a duplicate -- re-thrown, swallowed by the outer catch, still 200", async () => {
    fakeEmailTable.create = async () => {
      throw new Error("some unrelated database error");
    };

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mockRunExtraction).not.toHaveBeenCalled();
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalledWith({ data: { reason: "duplicate_messageid" } });
  });
});

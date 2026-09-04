import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Self-email ingestion loop guard (TASKS.md 🔴 Now, 2026-09-02) — users'
// Gmail auto-forward rules route our own outbound reminder/digest/
// refund-check-in sends back into our own inbound webhook, corrupting
// Order fields (confirmed on returnPortalUrl). Deliberately does NOT mock
// @/lib/selfOutboundGuard or @/lib/forwardResolver's classifyForwardType —
// the real detection logic is what's under test here, wired through the
// real route. Real evidence from investigations/2026-09-02-extraction-root-
// cause/traces.md: every confirmed self-loop row arrived with
// From: reminders@myreturnwindow.com, forwardType "auto".

const TEST_TOKEN = "tok_abc123";
const TEST_USER = { id: "user_1", email: "test@example.com", inboundToken: TEST_TOKEN };

function makeFakeEmailTable() {
  const rows: { id: string; userId: string; messageId: string | null }[] = [];
  let nextId = 1;
  return {
    rows,
    async findFirst({ where }: { where: { userId: string; messageId: string } }) {
      return rows.find((r) => r.userId === where.userId && r.messageId === where.messageId) ?? null;
    },
    async create({ data }: { data: { userId: string; messageId?: string | null } }) {
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

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAt: new Date() }),
}));

vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => "body" }));

const mockRunExtraction = vi.fn();
vi.mock("@/lib/runExtraction", () => ({ runExtraction: mockRunExtraction }));

const { POST } = await import("../app/api/inbound/route");

function makeRequest(fromEmail: string, headers: { Name: string; Value: string }[] = [], overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("https://app.myreturnwindow.com/api/inbound", {
    method: "POST",
    body: JSON.stringify({
      MailboxHash: TEST_TOKEN,
      FromFull: { Email: fromEmail, Name: "Sender" },
      Subject: "2 days left to return: The RealReal",
      TextBody: "...",
      MessageID: "msg-abc-123",
      Headers: headers,
      ...overrides,
    }),
  });
}

describe("POST /api/inbound — self-outbound-loop guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeEmailTable = makeFakeEmailTable();
    mockPrisma.user.findUnique.mockResolvedValue(TEST_USER);
    mockIsCommerceEmail.mockResolvedValue(true);
  });

  it("rejects a synthetic self-loop email (From: reminders@myreturnwindow.com, Gmail auto-forward headers) — no Email row created, discard logged", async () => {
    const response = await POST(
      makeRequest("reminders@myreturnwindow.com", [
        { Name: "Return-Path", Value: "<reminders+caf_=user=gmail.com@myreturnwindow.com>" },
        { Name: "X-Forwarded-For", Value: "user@gmail.com" },
      ]),
    );

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(0);
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
    expect(mockIsCommerceEmail).not.toHaveBeenCalled();
    expect(mockRunExtraction).not.toHaveBeenCalled();
  });

  it("rejects a self-loop even without Gmail auto-forward markers — From-domain match alone is sufficient", async () => {
    const response = await POST(makeRequest("hello@myreturnwindow.com", []));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(0);
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
  });

  it("does NOT filter a genuine user reply to one of our outbound emails — From is the user's own address, record created normally", async () => {
    const response = await POST(
      makeRequest("user@gmail.com", [{ Name: "Return-Path", Value: "<user@gmail.com>" }], {
        Subject: "Re: 2 days left to return: The RealReal",
        TextBody: "Thanks!\n\nOn Tue, Sep 2, someone wrote:\n> 2 days left to return...",
      }),
    );

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
    expect(mockIsCommerceEmail).toHaveBeenCalledTimes(1);
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });

  it("does NOT filter an ordinary retailer email — existing pipeline unchanged", async () => {
    const response = await POST(makeRequest("orders@mango.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
    expect(mockIsCommerceEmail).toHaveBeenCalledTimes(1);
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });

  it("matches case-insensitively and matches subdomains of myreturnwindow.com", async () => {
    const response = await POST(makeRequest("Reminders@MyReturnWindow.COM"));
    expect(fakeEmailTable.rows).toHaveLength(0);
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });

    fakeEmailTable = makeFakeEmailTable();
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(TEST_USER);
    mockIsCommerceEmail.mockResolvedValue(true);

    const response2 = await POST(makeRequest("someone@mail.myreturnwindow.com"));
    expect(fakeEmailTable.rows).toHaveLength(0);
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
    void response2;
    void response;
  });

  it("does not false-positive on an unrelated domain that merely ends with the same characters — dot-boundary matching, not substring", async () => {
    const response = await POST(makeRequest("orders@evilmyreturnwindow.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalledWith({ data: { reason: "self_outbound_loop" } });
  });
});

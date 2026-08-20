import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Food + grocery delivery exclusion, sender-domain layer (TASKS.md 🔴 Now,
// 2026-08-18) — the cost win: a matched sender must skip BOTH the Haiku
// commerce classifier AND the Sonnet extraction call, while still creating
// the Email row with junkedAt pre-set (never a silent discard). Deliberately
// does NOT mock @/lib/junk or @/lib/foodGroceryExclusion — the real
// shouldAutoJunk/extractDomain logic is what's under test here, wired
// through the real route.

const TEST_TOKEN = "tok_abc123";
const TEST_USER = { id: "user_1", email: "test@example.com", inboundToken: TEST_TOKEN };

function makeFakeEmailTable() {
  const rows: { id: string; userId: string; messageId: string | null; junkedAt: Date | null }[] = [];
  let nextId = 1;
  return {
    rows,
    async findFirst({ where }: { where: { userId: string; messageId: string } }) {
      return rows.find((r) => r.userId === where.userId && r.messageId === where.messageId) ?? null;
    },
    async create({ data }: { data: { userId: string; messageId?: string | null; junkedAt?: Date | null } }) {
      const row = { id: `email_${nextId++}`, userId: data.userId, messageId: data.messageId ?? null, junkedAt: data.junkedAt ?? null };
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

vi.mock("@/lib/forwardResolver", () => ({
  classifyForwardType: () => "manual",
  resolveAnchorDate: () => ({ anchorDate: null, anchorSource: "unresolved" }),
}));

vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => "body" }));

const mockRunExtraction = vi.fn();
vi.mock("@/lib/runExtraction", () => ({ runExtraction: mockRunExtraction }));

const { POST } = await import("../app/api/inbound/route");

function makeRequest(fromEmail: string, overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("https://app.myreturnwindow.com/api/inbound", {
    method: "POST",
    body: JSON.stringify({
      MailboxHash: TEST_TOKEN,
      FromFull: { Email: fromEmail, Name: "Sender" },
      Subject: "Your order confirmation",
      TextBody: "...",
      MessageID: "msg-abc-123",
      ...overrides,
    }),
  });
}

describe("POST /api/inbound — sender-domain pre-junk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeEmailTable = makeFakeEmailTable();
    mockPrisma.user.findUnique.mockResolvedValue(TEST_USER);
    mockIsCommerceEmail.mockResolvedValue(true);
  });

  it("creates the row with junkedAt pre-set and skips BOTH Haiku and Sonnet, for each enumerated domain", async () => {
    const response = await POST(makeRequest("orders@doordash.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(fakeEmailTable.rows[0].junkedAt).toBeInstanceOf(Date);
    expect(mockIsCommerceEmail).not.toHaveBeenCalled();
    expect(mockRunExtraction).not.toHaveBeenCalled();
  });

  it("matches case-insensitively", async () => {
    const response = await POST(makeRequest("Orders@DoorDash.COM"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows[0].junkedAt).toBeInstanceOf(Date);
    expect(mockIsCommerceEmail).not.toHaveBeenCalled();
  });

  it("does NOT pre-junk a real Amazon sender — Haiku/Sonnet still run normally", async () => {
    const response = await POST(makeRequest("order-update@amazon.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows[0].junkedAt).toBeNull();
    expect(mockIsCommerceEmail).toHaveBeenCalledTimes(1);
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });

  it.each(["auto-confirm@mail.amazon.com", "shipment-tracking@email.amazon.com"])(
    "does NOT pre-junk an Amazon subdomain sender (%s) — dot-boundary matching, not substring; Haiku/Sonnet still run normally",
    async (fromEmail) => {
      const response = await POST(makeRequest(fromEmail));

      expect(response.status).toBe(200);
      expect(fakeEmailTable.rows[0].junkedAt).toBeNull();
      expect(mockIsCommerceEmail).toHaveBeenCalledTimes(1);
      expect(mockRunExtraction).toHaveBeenCalledTimes(1);
    },
  );

  it("does NOT pre-junk an unrelated retailer — existing pipeline unchanged", async () => {
    const response = await POST(makeRequest("orders@mango.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows[0].junkedAt).toBeNull();
    expect(mockIsCommerceEmail).toHaveBeenCalledTimes(1);
    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
  });

  it("existing non-commerce discard path is unchanged for a non-matching sender", async () => {
    mockIsCommerceEmail.mockResolvedValue(false);

    const response = await POST(makeRequest("newsletter@somebrand.com"));

    expect(response.status).toBe(200);
    expect(fakeEmailTable.rows).toHaveLength(0); // discarded, never stored — unlike pre-junk, which always stores
    expect(mockPrisma.discardLog.create).toHaveBeenCalledWith({ data: { reason: "non_commerce" } });
    expect(mockRunExtraction).not.toHaveBeenCalled();
  });

  it("the pre-junked row is still rescuable — not a discard, a real row with junkedAt set", async () => {
    await POST(makeRequest("orders@goodeggs.com"));

    expect(fakeEmailTable.rows).toHaveLength(1);
    expect(mockPrisma.discardLog.create).not.toHaveBeenCalled();
  });
});

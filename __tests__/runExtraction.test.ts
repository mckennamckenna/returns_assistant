import { vi, describe, it, expect, beforeEach } from "vitest";

// runExtraction.ts:8 findUnique-gap fix (TASKS.md 2026-08-08). The bug:
// the id-based re-fetch sat OUTSIDE the function's own try/catch, so a
// throw there (e.g. a DB hiccup right after the row's own create()) left
// the row silently extractedAt: null / needsReview: false -- indistinguishable
// from "never called," no retry path. Fix: (1) inbound route now passes the
// already-loaded object, skipping the re-fetch entirely; (2) the re-fetch,
// for callers that still only hold an id, now lives inside the try/catch,
// so a throw there gets stamped exactly like any other extraction failure.

const mockEmailFindUnique = vi.fn();
const mockEmailUpdate = vi.fn();
const mockPrisma = {
  email: {
    findUnique: mockEmailFindUnique,
    update: mockEmailUpdate,
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockExtractEmail = vi.fn();
vi.mock("@/lib/extract", () => ({ extractEmail: mockExtractEmail }));

const mockLinkEmailToOrder = vi.fn();
vi.mock("@/lib/linkOrder", () => ({ linkEmailToOrder: mockLinkEmailToOrder }));

vi.mock("@/lib/crypto", () => ({ decrypt: (x: string) => x }));
vi.mock("@/lib/emailBodyText", () => ({
  resolveBodyTextWithAlternate: (t: string | null) => ({ primary: t, alternate: null }),
}));

const { runExtraction } = await import("../lib/runExtraction");

const BASE_ROW = {
  id: "email_1",
  textBody: "some body text",
  htmlBody: null,
  subject: "Your order shipped",
};

const EXTRACT_RESULT = {
  emailType: "shipping_confirmation",
  retailer: "Acme",
  orderNumber: "123",
  orderDate: null,
  deliveryDate: null,
  estimatedDeliveryDate: null,
  deliveredAt: null,
  returnWindowDays: 30,
  returnWindowStartsFrom: "delivery_date",
  returnDeadline: null,
  deadlineIsEstimated: false,
  policySource: null,
  orderTotal: null,
  orderCurrency: null,
  refundAmount: null,
  refundAmountConfidence: null,
  lineItems: null,
  confidence: "high",
  needsReview: false,
  notes: null,
  returnPortalUrl: null,
};

describe("runExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractEmail.mockResolvedValue(EXTRACT_RESULT);
  });

  it("(1) a re-fetch that throws still ends up stamped, never silent-null -- the original bug", async () => {
    mockEmailFindUnique.mockRejectedValue(new Error("connection reset"));

    await runExtraction(BASE_ROW.id);

    // Previously: findUnique threw outside the try/catch, propagated to the
    // caller, and NOTHING was written -- extractedAt stayed null, needsReview
    // stayed false, forever. Now: the throw is caught, and the row is
    // stamped exactly like any other extraction failure.
    expect(mockEmailUpdate).toHaveBeenCalledWith({
      where: { id: BASE_ROW.id },
      data: { needsReview: true, extractedAt: expect.any(Date) },
    });
    expect(mockExtractEmail).not.toHaveBeenCalled();
  });

  it("(2) happy path unchanged -- id-based call still re-fetches and extracts normally", async () => {
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);

    await runExtraction(BASE_ROW.id);

    expect(mockEmailFindUnique).toHaveBeenCalledWith({ where: { id: BASE_ROW.id } });
    expect(mockExtractEmail).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null);
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_ROW.id }, data: expect.objectContaining({ retailer: "Acme" }) }),
    );
    expect(mockLinkEmailToOrder).toHaveBeenCalledWith(BASE_ROW.id, null);
  });

  it("(2b) happy path unchanged -- passing the object directly skips the re-fetch entirely (the inbound-route case)", async () => {
    await runExtraction(BASE_ROW as never);

    expect(mockEmailFindUnique).not.toHaveBeenCalled();
    expect(mockExtractEmail).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null);
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_ROW.id }, data: expect.objectContaining({ retailer: "Acme" }) }),
    );
  });

  it("(3) the !email branch (row genuinely not found) is exercised and logs rather than silently no-oping", async () => {
    mockEmailFindUnique.mockResolvedValue(null);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runExtraction("nonexistent_id");

    expect(mockEmailUpdate).not.toHaveBeenCalled(); // nothing to write to
    expect(mockExtractEmail).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("runExtraction: no email row found for id", "nonexistent_id");
    errorSpy.mockRestore();
  });

  it("an extraction failure downstream of the re-fetch is still caught and stamped, same as before the fix", async () => {
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);
    mockExtractEmail.mockRejectedValue(new Error("model call failed"));

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith({
      where: { id: BASE_ROW.id },
      data: { needsReview: true, extractedAt: expect.any(Date) },
    });
  });
});

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

const mockExtractEmailIdentity = vi.fn();
const mockFinalizeExtraction = vi.fn();
vi.mock("@/lib/extract", () => ({
  extractEmailIdentity: mockExtractEmailIdentity,
  finalizeExtraction: mockFinalizeExtraction,
}));

const mockLinkEmailToOrder = vi.fn();
const mockFindMatchingOrder = vi.fn();
vi.mock("@/lib/linkOrder", () => ({
  linkEmailToOrder: mockLinkEmailToOrder,
  findMatchingOrder: mockFindMatchingOrder,
}));

vi.mock("@/lib/crypto", () => ({ decrypt: (x: string) => x }));
vi.mock("@/lib/emailBodyText", () => ({
  resolveBodyTextWithAlternate: (t: string | null) => ({ primary: t, alternate: null }),
}));

const { runExtraction } = await import("../lib/runExtraction");

const BASE_ROW = {
  id: "email_1",
  userId: "user_1",
  textBody: "some body text",
  htmlBody: null,
  subject: "Your order shipped",
};

// Shape returned by extractEmailIdentity — the pre-finalize identity pass.
// returnWindowDays: null represents the common case (policy not yet known
// from the email body itself), which is what makes the pre-check gate
// (lib/runExtraction.ts) eligible to run in the baseline tests below.
const PARSED_IDENTITY = {
  emailType: "shipping_confirmation",
  retailer: "Acme",
  orderNumber: "123",
  orderDate: null,
  deliveryDate: null,
  shipByDate: null,
  returnWindowDays: null,
  returnWindowStartsFrom: null,
  orderTotal: null,
  orderCurrency: null,
  refundAmount: null,
  refundAmountConfidence: null,
  lineItems: [],
  returnPortalUrlFromEmail: null,
  confidence: "high",
  needsReview: false,
  notes: "",
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
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockFindMatchingOrder.mockResolvedValue(null);
    mockFinalizeExtraction.mockResolvedValue(EXTRACT_RESULT);
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
    expect(mockExtractEmailIdentity).not.toHaveBeenCalled();
  });

  it("(2) happy path unchanged -- id-based call still re-fetches and extracts normally", async () => {
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);

    await runExtraction(BASE_ROW.id);

    expect(mockEmailFindUnique).toHaveBeenCalledWith({ where: { id: BASE_ROW.id } });
    expect(mockExtractEmailIdentity).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null);
    expect(mockFindMatchingOrder).toHaveBeenCalledWith(BASE_ROW.userId, PARSED_IDENTITY.retailer, PARSED_IDENTITY.orderNumber);
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, null);
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_ROW.id }, data: expect.objectContaining({ retailer: "Acme" }) }),
    );
    expect(mockLinkEmailToOrder).toHaveBeenCalledWith(BASE_ROW.id, null);
  });

  it("(2b) happy path unchanged -- passing the object directly skips the re-fetch entirely (the inbound-route case)", async () => {
    await runExtraction(BASE_ROW as never);

    expect(mockEmailFindUnique).not.toHaveBeenCalled();
    expect(mockExtractEmailIdentity).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null);
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_ROW.id }, data: expect.objectContaining({ retailer: "Acme" }) }),
    );
  });

  it("(3) the !email branch (row genuinely not found) is exercised and logs rather than silently no-oping", async () => {
    mockEmailFindUnique.mockResolvedValue(null);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runExtraction("nonexistent_id");

    expect(mockEmailUpdate).not.toHaveBeenCalled(); // nothing to write to
    expect(mockExtractEmailIdentity).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("runExtraction: no email row found for id", "nonexistent_id");
    errorSpy.mockRestore();
  });

  it("an extraction failure downstream of the re-fetch is still caught and stamped, same as before the fix", async () => {
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);
    mockExtractEmailIdentity.mockRejectedValue(new Error("model call failed"));

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith({
      where: { id: BASE_ROW.id },
      data: { needsReview: true, extractedAt: expect.any(Date) },
    });
  });
});

// The parent-order pre-check itself (TASKS.md 2026-08-24 widened
// lookupReturnPolicy skip). finalizeExtraction's own branch logic (the
// actual skip decision) lives in lib/extract.ts and isn't unit-tested here
// or there -- extract.test.ts only covers extract.ts's small pure helpers,
// since testing extractEmail/finalizeExtraction's branches directly would
// require mocking the Anthropic SDK, which no test in this codebase does
// today (the pre-existing Amazon-default and food-grocery branches aren't
// unit-tested either). What IS testable, and covered below, is
// runExtraction.ts's own orchestration: does it call findMatchingOrder at
// all, with what arguments, and does it correctly skip that DB read for
// retailers that could never reach the billed branch regardless.
describe("runExtraction — parent-order pre-check wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);
    mockFinalizeExtraction.mockResolvedValue(EXTRACT_RESULT);
  });

  it("shapes a found match into ExistingOrderContext (returnWindowDays only) before calling finalizeExtraction", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockFindMatchingOrder.mockResolvedValue({
      matchType: "exact",
      order: { id: "order_1", returnWindowDays: 30, retailer: "Acme", displayStatus: "delivered" },
    });

    await runExtraction(BASE_ROW.id);

    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, { returnWindowDays: 30 });
  });

  it("passes null existingOrder when findMatchingOrder finds nothing", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockFindMatchingOrder.mockResolvedValue(null);

    await runExtraction(BASE_ROW.id);

    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, null);
  });

  it("skips the pre-check query entirely for an Amazon retailer -- never reaches the billed branch regardless", async () => {
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: "Amazon" });

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(expect.objectContaining({ retailer: "Amazon" }), BASE_ROW.id, null);
  });

  it("skips the pre-check query entirely for a food/grocery retailer -- never reaches the billed branch regardless", async () => {
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: "Whole Foods Market" });

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
  });

  it("skips the pre-check query when the email itself already states its own returnWindowDays -- that branch is free, no lookup to save", async () => {
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, returnWindowDays: 45 });

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
  });

  it("skips the pre-check query when orderNumber is null -- findMatchingOrder requires one", async () => {
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, orderNumber: null });

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: null }), BASE_ROW.id, null);
  });
});

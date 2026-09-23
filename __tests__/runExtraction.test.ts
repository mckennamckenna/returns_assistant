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
  fromEmail: "noreply@acme.com",
  fromName: "Acme",
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
    expect(mockExtractEmailIdentity).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null, null);
    expect(mockFindMatchingOrder).toHaveBeenCalledWith(BASE_ROW.userId, PARSED_IDENTITY.retailer, PARSED_IDENTITY.orderNumber);
    // 4th arg is effectiveRetailer -- equal to parsed.retailer here since
    // it's already non-null (fallback never consulted). See the dedicated
    // "effectiveRetailer wiring" describe block below for the fallback-
    // resolved and fallback-not-consulted cases.
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, null, PARSED_IDENTITY.retailer, null, false);
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_ROW.id }, data: expect.objectContaining({ retailer: "Acme" }) }),
    );
    expect(mockLinkEmailToOrder).toHaveBeenCalledWith(BASE_ROW.id, null);
  });

  it("(2b) happy path unchanged -- passing the object directly skips the re-fetch entirely (the inbound-route case)", async () => {
    await runExtraction(BASE_ROW as never);

    expect(mockEmailFindUnique).not.toHaveBeenCalled();
    expect(mockExtractEmailIdentity).toHaveBeenCalledWith(BASE_ROW.textBody, BASE_ROW.subject, BASE_ROW.id, null, null);
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
// actual skip decision) lives in lib/extract.ts.
// CORRECTED 2026-09-22: this comment used to say that branch "isn't
// unit-tested here or there" because doing so "would require mocking the
// Anthropic SDK, which no test in this codebase does today." Both halves
// are now out of date -- extractRetry/extractUsageLogging/classify/
// anthropicUsage all mock the SDK, and __tests__/policyLookupCarrierGate
// .test.ts now covers finalizeExtraction's gate directly (including the
// Amazon-default branch this comment called untested). What IS testable
// here, and covered below, is
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

    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, { returnWindowDays: 30 }, PARSED_IDENTITY.retailer, null, false);
  });

  it("passes null existingOrder when findMatchingOrder finds nothing", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockFindMatchingOrder.mockResolvedValue(null);

    await runExtraction(BASE_ROW.id);

    expect(mockFinalizeExtraction).toHaveBeenCalledWith(PARSED_IDENTITY, BASE_ROW.id, null, PARSED_IDENTITY.retailer, null, false);
  });

  it("skips the pre-check query entirely for an Amazon retailer -- never reaches the billed branch regardless", async () => {
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: "Amazon" });

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(expect.objectContaining({ retailer: "Amazon" }), BASE_ROW.id, null, "Amazon", null, false);
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
    // 6th arg (senderIsCarrier) added 2026-09-22 — a mechanical arity
    // update only. This test's subject, that findMatchingOrder is not
    // called when orderNumber is null, is deliberately unchanged: the
    // :97 order-number skip was NOT touched by root cause (a)'s fix.
    // BASE_ROW's sender is noreply@acme.com, so false is correct here.
    expect(mockFinalizeExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: null }),
      BASE_ROW.id,
      null,
      PARSED_IDENTITY.retailer,
      null,
      false,
    );
  });
});

// ZARA_RETAILER_FALLBACK (2026-08-25) — the sender-derived fallback, now
// computed in runExtraction.ts BEFORE finalizeExtraction runs (TASKS.md
// 2026-09-11/13 fix session), then reused at the post-finalizeExtraction
// DB-write step. Uses the REAL lib/retailerFallback.ts (not mocked) --
// it's pure, deterministic logic, so exercising it for real here is more
// useful than re-asserting a mock call. decrypt() is mocked as identity
// (see top of file), so BASE_ROW's fromEmail/fromName pass straight
// through unchanged.
//
// IMPORTANT for anyone adding a case here: the fallback now reads
// parsed.retailer / parsed.emailType (extractEmailIdentity's output),
// NOT result.retailer / result.emailType (finalizeExtraction's output).
// Mock mockExtractEmailIdentity's return value to simulate "body
// extraction found nothing" -- overriding mockFinalizeExtraction's
// retailer/emailType alone (the pre-fix pattern) no longer has any
// effect on whether the fallback fires, since finalizeExtraction is
// mocked and its real internals never run in this file.
describe("runExtraction — sender-derived retailer fallback (ZARA_RETAILER_FALLBACK)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockFindMatchingOrder.mockResolvedValue(null);
    mockFinalizeExtraction.mockResolvedValue(EXTRACT_RESULT);
  });

  it("body extraction returned a retailer -- fallback does not fire, retailerSource = 'body_extraction'", async () => {
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: "Acme" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: "Acme", retailerSource: "body_extraction" }) }),
    );
  });

  it("Zara case: retailer null, commerce emailType, fromName 'Zara' -- resolves to 'Zara' via sender_fallback", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "noreply@zara.com", fromName: "Zara" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: "Zara", retailerSource: "sender_fallback" }) }),
    );
  });

  it("carrier case (FedEx): retailer stays null, retailerSource = 'carrier_deferred', NOT mislabeled 'FedEx Delivery Manager'", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "TrackingUpdates@fedex.com", fromName: "FedEx Delivery Manager" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: null, retailerSource: "carrier_deferred" }) }),
    );
  });

  it("carrier case (USPS): retailer stays null, retailerSource = 'carrier_deferred', NOT mislabeled 'USPS Tracking'", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "auto-reply@tracking.usps.com", fromName: "USPS Tracking" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "delivery" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "delivery" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: null, retailerSource: "carrier_deferred" }) }),
    );
  });

  it("carrier-sender email typed 'other' (non-commerce): gate condition (ii) fails -- fallback never runs, retailerSource stays null, not 'carrier_deferred'", async () => {
    // This is the gate the design's own Decision 2(ii) documents as
    // load-bearing: the carrier check only ever runs once emailType has
    // already passed the commerce-type gate. A carrier email typed "other"
    // (e.g. a promotional/marketing send from a carrier domain) must not
    // be tagged carrier_deferred either -- it should look exactly like any
    // other non-commerce null-retailer row. Rewritten 2026-09-13: the
    // pre-fix version of this test only varied mockFinalizeExtraction's
    // emailType, while mockExtractEmailIdentity stayed at the default
    // PARSED_IDENTITY (retailer: "Acme", non-null) -- so it happened to
    // pass because the fallback's retailer-nullness precondition was
    // never met, not because gate condition (ii) was exercised at all.
    // Now varies parsed.retailer AND parsed.emailType together, the actual
    // inputs the fallback gate reads.
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "TrackingUpdates@fedex.com", fromName: "FedEx Delivery Manager" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "other" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "other" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: null, retailerSource: null }) }),
    );
  });

  it("ESP subdomain case: orders@email.bloomingdales.com, generic fromName -- resolves to 'Bloomingdales' via domain, stripping the email. prefix", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "orders@email.bloomingdales.com", fromName: "noreply" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: "Bloomingdales", retailerSource: "sender_fallback" }) }),
    );
  });

  it("fromName and fromEmail both empty/unresolvable: retailer stays null, retailerSource stays null (never invents a value)", async () => {
    // Rewritten 2026-09-13, same reason as the 'other' case above: the
    // pre-fix version left mockExtractEmailIdentity at the default
    // PARSED_IDENTITY (retailer: "Acme"), so the fallback's gate was
    // never actually reached -- the assertion passed vacuously. Now sets
    // parsed.retailer: null with an eligible emailType, so the fallback
    // gate genuinely opens and resolveRetailerFallback's own Step 4
    // ("nothing resolved") is what's under test.
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "", fromName: null });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: null, retailerSource: null }) }),
    );
  });
});

// TASKS.md 2026-09-11/13 fix session -- effectiveRetailer wiring. Covers
// the specific behaviors the owner called out when confirming Gate 3:
// (1) finalizeExtraction receives a 4th arg, the effective retailer;
// (2) that arg is the sender-fallback-resolved value, used at BOTH the
//     findMatchingOrder pre-check and the finalizeExtraction call, when
//     parsed.retailer is null and the sender is fallback-eligible;
// (3) that arg equals parsed.retailer, and the fallback is not preferred
//     over it, when parsed.retailer is already non-null;
// (5) parsed.retailer itself is never mutated -- finalizeExtraction's
//     first argument still carries the original (possibly null) value,
//     which is what lets retailerSource labeling (tested above) keep
//     distinguishing body_extraction from sender_fallback.
// (4) is NOT independently covered here: isAmazonOrder,
//     isFoodGroceryRetailer, the lookupReturnPolicy gate, and
//     computeNeedsReview all live INSIDE finalizeExtraction, which this
//     file mocks -- exercising their real branches would require mocking
//     the Anthropic SDK, which no test in this codebase does today (see
//     the "parent-order pre-check wiring" describe block's own comment
//     above for the same, pre-existing limitation on the Amazon/
//     food-grocery branches). What IS verified here is the mechanism
//     those four consumers all depend on: that effectiveRetailer, not
//     parsed.retailer, is the value that actually reaches
//     finalizeExtraction as its 4th argument. Whether each internal
//     branch reads that argument correctly is verified by code review of
//     lib/extract.ts, not by a test in this file.
describe("runExtraction — effectiveRetailer wiring (2026-09-11/13 fix session)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailFindUnique.mockResolvedValue(BASE_ROW);
    mockFindMatchingOrder.mockResolvedValue(null);
    mockFinalizeExtraction.mockResolvedValue(EXTRACT_RESULT);
  });

  // Arity updated 2026-09-20 (ANCHOR_DATE_RESOLVER.md Part 3): a 5th arg,
  // the Email row's anchorDate, now follows effectiveRetailer. Updated
  // again 2026-09-22 (TASKS.md root cause (a)): a 6th arg, senderIsCarrier,
  // follows anchorDate. The 4th-arg assertion this test exists for is
  // unchanged through both.
  it("(1) finalizeExtraction is called with exactly 6 args, the 4th being effectiveRetailer", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);

    await runExtraction(BASE_ROW.id);

    expect(mockFinalizeExtraction).toHaveBeenCalledTimes(1);
    const call = mockFinalizeExtraction.mock.calls[0];
    expect(call).toHaveLength(6);
    expect(call[3]).toBe(PARSED_IDENTITY.retailer);
  });

  // The 6th arg is an ENVELOPE fact and must be computed from the sender,
  // independently of whatever the body named as the retailer — that
  // independence is the whole point of root cause (a)'s fix, since the H&M
  // case is precisely where the two disagree (UPS sender, body says H&M).
  it("(1b) senderIsCarrier is passed as the 6th arg, derived from the sender and not from the body's retailer", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "pkginfo@ups.com" });

    await runExtraction(BASE_ROW.id);

    const call = mockFinalizeExtraction.mock.calls[0];
    expect(call[5]).toBe(true);
    // ...while the body-extracted retailer is untouched by it.
    expect(call[3]).toBe(PARSED_IDENTITY.retailer);
  });

  it("(1c) a non-carrier sender passes senderIsCarrier false", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "orders@email.bloomingdales.com" });

    await runExtraction(BASE_ROW.id);

    expect(mockFinalizeExtraction.mock.calls[0][5]).toBe(false);
  });

  // Both production entry points must compute this, not just the id-based
  // one. Verified 2026-09-22 that runExtraction is the ONLY production path
  // to finalizeExtraction (app/ never imports @/lib/extract): the inbound
  // Postmark webhook passes the ROW OBJECT (app/api/inbound/route.ts:397,
  // skipping the re-fetch entirely), while the manual re-extract action
  // passes an id (app/(app)/emails/[id]/actions.ts:17). This covers the
  // object path, which is the higher-volume one and the one that never
  // touches findUnique.
  it("(1d) the object path (inbound webhook) computes senderIsCarrier too, not just the id path", async () => {
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY);

    await runExtraction({ ...BASE_ROW, fromEmail: "pkginfo@ups.com" } as never);

    expect(mockEmailFindUnique).not.toHaveBeenCalled();
    expect(mockFinalizeExtraction.mock.calls[0][5]).toBe(true);
  });

  it("(2) parsed.retailer null + fallback-eligible sender -- effectiveRetailer is the fallback-resolved value at BOTH the findMatchingOrder pre-check and the finalizeExtraction call", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "noreply@zara.com", fromName: "Zara" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    // Pre-check read point.
    expect(mockFindMatchingOrder).toHaveBeenCalledWith(BASE_ROW.userId, "Zara", PARSED_IDENTITY.orderNumber);
    // finalizeExtraction gate read point.
    const call = mockFinalizeExtraction.mock.calls[0];
    expect(call[3]).toBe("Zara");
    // parsed.retailer (1st arg) stays null -- see test (5) below for the
    // dedicated assertion; checked here too since it's the same call.
    expect(call[0].retailer).toBeNull();
  });

  it("(3) parsed.retailer non-null -- effectiveRetailer equals parsed.retailer, fallback not preferred even when the sender would resolve to a different retailer", async () => {
    // fromEmail/fromName here would resolve to "Zara" via sender-fallback
    // if the fallback were consulted -- it must not be, since
    // parsed.retailer ("Acme") is already non-null.
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "noreply@zara.com", fromName: "Zara" });
    mockExtractEmailIdentity.mockResolvedValue(PARSED_IDENTITY); // retailer: "Acme"

    await runExtraction(BASE_ROW.id);

    expect(mockFindMatchingOrder).toHaveBeenCalledWith(BASE_ROW.userId, "Acme", PARSED_IDENTITY.orderNumber);
    const call = mockFinalizeExtraction.mock.calls[0];
    expect(call[3]).toBe("Acme");
  });

  it("(5) parsed.retailer is never mutated, even when effectiveRetailer differs from it", async () => {
    mockEmailFindUnique.mockResolvedValue({ ...BASE_ROW, fromEmail: "noreply@zara.com", fromName: "Zara" });
    mockExtractEmailIdentity.mockResolvedValue({ ...PARSED_IDENTITY, retailer: null, emailType: "shipping_confirmation" });
    mockFinalizeExtraction.mockResolvedValue({ ...EXTRACT_RESULT, retailer: null, emailType: "shipping_confirmation" });

    await runExtraction(BASE_ROW.id);

    const call = mockFinalizeExtraction.mock.calls[0];
    // effectiveRetailer (4th arg) resolved via fallback...
    expect(call[3]).toBe("Zara");
    // ...but parsed.retailer (1st arg, the object finalizeExtraction
    // receives and later spreads into its return value) is untouched.
    expect(call[0].retailer).toBeNull();
    // And the write downstream still correctly labels this
    // sender_fallback, not body_extraction -- proving the mutation
    // didn't happen anywhere in the pipeline, not just at this one call.
    expect(mockEmailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retailer: "Zara", retailerSource: "sender_fallback" }) }),
    );
  });
});

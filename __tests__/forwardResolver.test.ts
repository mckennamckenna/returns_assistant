import { vi, describe, it, expect } from "vitest";

// lib/forwardResolver.ts imports parseForwardedHeaderDate from
// lib/linkOrder.ts, which constructs a real Prisma client at module load —
// same mock set linkOrder.test.ts uses, needed here for the same reason.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/crypto", () => ({ decrypt: (x: string) => x }));
vi.mock("@/lib/emailBodyText", () => ({ resolveBodyText: () => null }));
vi.mock("@/lib/extract", () => ({
  computeDeadline: () => ({ returnDeadline: null, deadlineIsEstimated: false }),
  normalizeReturnPortalUrl: (x: string | null) => x,
  classifyReturnPortalTrust: () => "unknown-unverified",
}));
vi.mock("@/lib/displayStatus", async () => {
  const real = await vi.importActual<typeof import("../lib/displayStatus")>("../lib/displayStatus");
  return real;
});
vi.mock("@/lib/trackingParser", () => ({
  parseTrackingResolved: () => ({ carrier: null, trackingNumber: null, trackingUrl: null }),
}));

const { classifyForwardType, resolveAnchorDate, forwardTypeLabel } = await import("../lib/forwardResolver");

describe("classifyForwardType", () => {
  it("classifies auto via Gmail's Return-Path +caf_= marker", () => {
    const headers = [{ Name: "Return-Path", Value: "<bounce+caf_=user=example.com@gmail.com>" }];
    expect(classifyForwardType(headers)).toBe("auto");
  });

  it("classifies auto via X-Forwarded-For presence", () => {
    const headers = [{ Name: "X-Forwarded-For", Value: "user@gmail.com" }];
    expect(classifyForwardType(headers)).toBe("auto");
  });

  it("classifies auto via X-Forwarded-To presence", () => {
    const headers = [{ Name: "X-Forwarded-To", Value: "tok_abc123@mail.myreturnwindow.com" }];
    expect(classifyForwardType(headers)).toBe("auto");
  });

  it("is case-insensitive on header names", () => {
    const headers = [{ Name: "x-forwarded-for", Value: "user@gmail.com" }];
    expect(classifyForwardType(headers)).toBe("auto");
  });

  it("defaults to manual when headers are present but carry no auto-forward signature", () => {
    const headers = [
      { Name: "Return-Path", Value: "<hi@retailer.com>" },
      { Name: "From", Value: "Retailer <hi@retailer.com>" },
    ];
    expect(classifyForwardType(headers)).toBe("manual");
  });

  it("defaults to manual when headers are empty", () => {
    expect(classifyForwardType([])).toBe("manual");
  });

  it("defaults to manual when headers are missing entirely (null/undefined)", () => {
    expect(classifyForwardType(null)).toBe("manual");
    expect(classifyForwardType(undefined)).toBe("manual");
  });
});

describe("resolveAnchorDate", () => {
  const receivedAt = new Date("2026-07-16T17:50:00.000Z");

  it("auto + a parseable original Date header -> anchors on it, source original_header", () => {
    const headers = [{ Name: "Date", Value: "Wed, 16 Jul 2026 17:47:00 +0000" }];
    const result = resolveAnchorDate({ forwardType: "auto", headers, bodyText: null, receivedAt });
    expect(result.anchorSource).toBe("original_header");
    expect(result.anchorDate?.toISOString().slice(0, 16)).toBe("2026-07-16T17:47");
  });

  it("auto + no Date header present -> falls back to receivedAt, source received_at", () => {
    const result = resolveAnchorDate({ forwardType: "auto", headers: [], bodyText: null, receivedAt });
    expect(result).toEqual({ anchorDate: receivedAt, anchorSource: "received_at" });
  });

  it("auto + an unparseable Date header -> falls back to receivedAt, source received_at", () => {
    const headers = [{ Name: "Date", Value: "not-a-real-date" }];
    const result = resolveAnchorDate({ forwardType: "auto", headers, bodyText: null, receivedAt });
    expect(result).toEqual({ anchorDate: receivedAt, anchorSource: "received_at" });
  });

  it("manual + a parseable Gmail quoted Date: line -> anchors on it, source quoted_body — the real Tuckernuck case", () => {
    // Real fixture (ANCHOR_DATE_RESOLVER.md worked example, 2026-07-25):
    // receivedAt Jul 16 5:50 PM, quoted body Jul 13 4:39 PM — 3-day gap.
    const bodyText =
      "---------- Forwarded message ---------\nFrom: Tuckernuck <hi@tnuck.com>\nDate: Mon, Jul 13, 2026 at 4:39 PM\nSubject: Your order shipped\n\nOn its way!";
    const result = resolveAnchorDate({ forwardType: "manual", headers: [], bodyText, receivedAt });
    expect(result.anchorSource).toBe("quoted_body");
    expect(result.anchorDate?.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("manual + no parseable quoted date -> unresolved, never falls back to receivedAt — the Emme Parsons case", () => {
    const bodyText = "Thanks for your order! No dates mentioned anywhere in this body.";
    const result = resolveAnchorDate({ forwardType: "manual", headers: [], bodyText, receivedAt });
    expect(result).toEqual({ anchorDate: null, anchorSource: "unresolved" });
  });

  it("manual + null body -> unresolved", () => {
    const result = resolveAnchorDate({ forwardType: "manual", headers: [], bodyText: null, receivedAt });
    expect(result).toEqual({ anchorDate: null, anchorSource: "unresolved" });
  });
});

describe("forwardTypeLabel", () => {
  it('labels "auto" as forwarded automatically', () => {
    expect(forwardTypeLabel("auto")).toBe("Forwarded automatically");
  });

  it('labels "manual" as forwarded by you', () => {
    expect(forwardTypeLabel("manual")).toBe("Forwarded by you");
  });

  it("labels null (pre-resolver row, never classified) as forwarded by you — same conservative default as classifyForwardType", () => {
    expect(forwardTypeLabel(null)).toBe("Forwarded by you");
  });
});

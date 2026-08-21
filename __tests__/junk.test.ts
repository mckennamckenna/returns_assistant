import { describe, it, expect } from "vitest";
import { shouldAutoJunk, JUNK_FILTER } from "../lib/junk";

// ── shouldAutoJunk ───────────────────────────────────────────────────────
// Scoped deliberately narrow: only emailType === "other" on an orphaned
// email (orderId still null). Two real populations were confirmed via
// production data to look superficially similar but must never auto-junk —
// see lib/junk.ts's comment for the full diagnostic.

describe("shouldAutoJunk", () => {
  it("junks an orphaned email with emailType 'other'", () => {
    expect(shouldAutoJunk({ emailType: "other", orderId: null })).toBe(true);
  });

  it("does NOT junk a commerce-typed email with no order number (the 15 real unlinked-purchase case)", () => {
    expect(shouldAutoJunk({ emailType: "delivery", orderId: null })).toBe(false);
    expect(shouldAutoJunk({ emailType: "shipping_confirmation", orderId: null })).toBe(false);
    expect(shouldAutoJunk({ emailType: "order_confirmation", orderId: null })).toBe(false);
    expect(shouldAutoJunk({ emailType: "return_label", orderId: null })).toBe(false);
    expect(shouldAutoJunk({ emailType: "refund", orderId: null })).toBe(false);
  });

  it("does NOT junk when emailType is null (the extraction-failure fingerprint, not a content signal)", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null })).toBe(false);
  });

  it("does NOT junk an 'other'-typed email that somehow did link to an order", () => {
    // Structurally shouldn't happen (linkEmailToOrder only ever calls this
    // from the branch where orderId is about to stay null) — but the
    // function itself should never junk a linked email regardless.
    expect(shouldAutoJunk({ emailType: "other", orderId: "some-order-id" })).toBe(false);
  });
});

// ── shouldAutoJunk — sender-domain branch ───────────────────────────────
// Food + grocery delivery exclusion (TASKS.md 🔴 Now, 2026-08-18). Called
// at ingestion (app/api/inbound/route.ts) before emailType/orderId are
// even known — a fromDomain match short-circuits independent of both.

describe("shouldAutoJunk — sender-domain match", () => {
  it("junks on a fromDomain match, regardless of emailType/orderId (pre-extraction: neither is known yet)", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "doordash.com" })).toBe(true);
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "instacart.com" })).toBe(true);
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "goodeggs.com" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "DoorDash.COM" })).toBe(true);
  });

  it("does NOT junk a real Amazon sender domain — the backstop, not this layer, covers Amazon-brand food", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "amazon.com" })).toBe(false);
  });

  it("does NOT junk an unrelated retailer domain", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "mango.com" })).toBe(false);
  });

  it("falls through to the emailType/orderId rule when fromDomain is absent (existing post-extraction call site is unaffected)", () => {
    expect(shouldAutoJunk({ emailType: "other", orderId: null })).toBe(true);
    expect(shouldAutoJunk({ emailType: "delivery", orderId: null })).toBe(false);
  });
});

// ── shouldAutoJunk — USPS carrier-ping domain match ─────────────────────
// USPS carrier-ping exclusion (TASKS.md 🔴 Now, needs-review bucket
// rebuild, 2026-08-21). Same layer/cost-win as the food-grocery branch
// above — a fromDomain match short-circuits before emailType/orderId are
// even known. Deliberately catches emailType "delivery"/"shipping_confirmation"
// too (unlike the food-grocery branch's neighbors, which only ever pre-junk
// at the domain layer): a bare USPS status ping IS commerce-adjacent
// content by emailType, but carries no return-tracking value regardless.

describe("shouldAutoJunk — USPS carrier-ping domain match", () => {
  it("junks a tracking.usps.com sender regardless of emailType/orderId", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "tracking.usps.com" })).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "Tracking.USPS.com" })).toBe(true);
  });

  it("does NOT junk the bare usps.com domain", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "usps.com" })).toBe(false);
  });

  it("does NOT junk an unrelated carrier domain", () => {
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "ups.com" })).toBe(false);
    expect(shouldAutoJunk({ emailType: null, orderId: null, fromDomain: "fedex.com" })).toBe(false);
  });
});

// ── JUNK_FILTER ──────────────────────────────────────────────────────────
// The shared where-clause fragment every email-listing consumer must
// spread in. Shape-only test — the real regression guard is the consumer
// audit itself (lib/junk.ts's comment enumerates every call site checked).

describe("JUNK_FILTER", () => {
  it("excludes junked emails via junkedAt: null", () => {
    expect(JUNK_FILTER).toEqual({ junkedAt: null });
  });
});

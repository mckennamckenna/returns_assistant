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

// ── JUNK_FILTER ──────────────────────────────────────────────────────────
// The shared where-clause fragment every email-listing consumer must
// spread in. Shape-only test — the real regression guard is the consumer
// audit itself (lib/junk.ts's comment enumerates every call site checked).

describe("JUNK_FILTER", () => {
  it("excludes junked emails via junkedAt: null", () => {
    expect(JUNK_FILTER).toEqual({ junkedAt: null });
  });
});

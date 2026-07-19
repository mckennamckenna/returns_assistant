import { describe, it, expect } from "vitest";
import {
  normalizeReturnPortalUrl,
  resolveReturnPortalUrlForWrite,
  notesIndicateTieredWindow,
  computeNeedsReview,
  TIERED_WINDOW_NOTE_MARKER,
  classifyReturnPortalTrust,
} from "../lib/extract";

// ── normalizeReturnPortalUrl ──────────────────────────────────────────────────
// Real bug: the AI sometimes extracts a bare domain/path (e.g.
// "on.com/en-us/faq/returns-and-exchanges") instead of a fully-qualified URL.
// Rendered as-is in an <a href>, the browser treats it as a relative path
// against the current origin and 404s. This is the belt-and-suspenders fix,
// called at every point returnPortalUrl enters the DB.

describe("normalizeReturnPortalUrl", () => {
  it("returns null for null", () => {
    expect(normalizeReturnPortalUrl(null)).toBe(null);
  });

  it("returns null for an empty string", () => {
    expect(normalizeReturnPortalUrl("")).toBe(null);
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizeReturnPortalUrl("   ")).toBe(null);
  });

  it("prepends https:// to a scheme-less URL", () => {
    expect(normalizeReturnPortalUrl("on.com/en-us/faq/returns-and-exchanges")).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("leaves an https:// URL unchanged", () => {
    expect(normalizeReturnPortalUrl("https://shop.mango.com/us/en/my-returns")).toBe(
      "https://shop.mango.com/us/en/my-returns",
    );
  });

  it("leaves an http:// URL unchanged", () => {
    expect(normalizeReturnPortalUrl("http://on.com/foo")).toBe("http://on.com/foo");
  });
});

// ── resolveReturnPortalUrlForWrite (extract-layer write path) ────────────────
// The exact function extractEmail() calls to produce the returnPortalUrl it
// persists — proves the write path normalizes, not just the standalone
// helper in isolation.

describe("resolveReturnPortalUrlForWrite", () => {
  it("normalizes a scheme-less URL from the email itself", () => {
    expect(resolveReturnPortalUrlForWrite("on.com/en-us/faq/returns-and-exchanges", null)).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("normalizes a scheme-less URL from the web-lookup fallback", () => {
    expect(resolveReturnPortalUrlForWrite(null, "on.com/en-us/faq/returns-and-exchanges")).toBe(
      "https://on.com/en-us/faq/returns-and-exchanges",
    );
  });

  it("prefers the email's own URL over the lookup's when both are present", () => {
    expect(resolveReturnPortalUrlForWrite("https://retailer.com/returns", "https://fallback.com/returns")).toBe(
      "https://retailer.com/returns",
    );
  });

  it("returns null when neither source has a URL", () => {
    expect(resolveReturnPortalUrlForWrite(null, null)).toBe(null);
  });
});

// ── classifyReturnPortalTrust (SECURITY_AUDIT.md M2) ──────────────────────────
// A SIGNAL feeding Order.needsReview, never a hard block. The core security
// property under test: matching happens on the REGISTRABLE domain only,
// never the raw hostname/subdomain chain — a hostname can contain the
// retailer's name as a subdomain label while a different party entirely
// controls the actual registrable domain.

describe("classifyReturnPortalTrust", () => {
  it("does NOT classify a look-alike subdomain as the retailer's own domain — the bloomreach/evil-cdn trap", () => {
    // Real shape observed in production: a Hanna Andersson marketing email's
    // link hostname contains "hannaandersson" as a subdomain label, but the
    // domain that actually controls the content is bloomreach.co, a
    // third-party ESP. A naive "hostname contains retailer name" check would
    // grant this the highest trust tier — the same shape an attacker domain
    // like "amazon.evil-cdn.com" would exploit to impersonate Amazon.
    expect(
      classifyReturnPortalTrust("https://hannaandersson-cdn.bloomreach.co/e/abc123", "Hanna Andersson", "stated_in_email"),
    ).toBe("unknown-unverified");
  });

  it("returns null when there's no URL at all — a missing link isn't itself suspicious", () => {
    expect(classifyReturnPortalTrust(null, "Nordstrom", "stated_in_email")).toBe(null);
  });

  it("classifies the retailer's own domain when the normalized name exactly matches the registrable domain", () => {
    expect(classifyReturnPortalTrust("https://shop.mango.com/us/en/my-returns", "MANGO", "web_lookup")).toBe(
      "retailer-own-domain",
    );
  });

  it("matches the retailer's own domain through punctuation/spacing differences (J.Crew / jcrew.com)", () => {
    expect(classifyReturnPortalTrust("https://www.jcrew.com/help/returns-exchanges", "J.Crew", "web_lookup")).toBe(
      "retailer-own-domain",
    );
  });

  it("does not grant retailer-own-domain trust via a short substring collision (\"On\" vs on.com is NOT an exact match)", () => {
    // "On (On-Running)" normalizes to "ononrunning", which does not exactly
    // equal "on" — deliberately no substring/contains matching here (see the
    // function's own comment): a short domain label like "on" would
    // otherwise match almost any retailer name containing those two letters.
    // This specific real retailer's own domain lands in unknown-unverified —
    // an accepted, measured trade-off, not a bug.
    expect(classifyReturnPortalTrust("https://on.com/en-us/faq/returns-and-exchanges", "On (On-Running)", "stated_in_email")).toBe(
      "unknown-unverified",
    );
  });

  it("classifies a confirmed-live known third-party portal domain (Loop Returns), even on a non-retailer-named subdomain", () => {
    expect(
      classifyReturnPortalTrust("https://api.loopreturns.com/api/redirect/return/123", "Ruti", "stated_in_email"),
    ).toBe("known-third-party-portal");
  });

  it("classifies a confirmed-live known third-party portal domain (Narvar)", () => {
    expect(classifyReturnPortalTrust("https://cta.narvar.com/f/a/abc", "Old Navy", "web_lookup")).toBe(
      "known-third-party-portal",
    );
  });

  it("checks the known-portal allowlist before retailer-domain matching", () => {
    // A known portal domain should never fall through to unknown-unverified
    // just because the retailer name happens not to match it — portal
    // domains are never expected to relate to the retailer's name at all.
    expect(classifyReturnPortalTrust("https://shopruti.loopreturns.com/", "Ruti", "stated_in_email")).toBe(
      "known-third-party-portal",
    );
  });

  it("correctly extracts the registrable domain across a multi-label ccTLD (co.uk)", () => {
    expect(
      classifyReturnPortalTrust("https://shop.southbankcentre.co.uk/pages/refund-policy", "Southbank Centre", "web_lookup"),
    ).toBe("retailer-own-domain");
  });

  it("classifies web-lookup-sourced as its own measurement-only tier when the domain doesn't textually match the retailer name", () => {
    // Real shape observed in production: COMMENSE's actual return-policy
    // page is thecommense.com — a legitimate retailer domain, but the
    // normalized retailer name ("commense") doesn't exactly match the
    // registrable domain's label ("thecommense"), so it can't earn
    // retailer-own-domain trust. Since the URL came via web lookup, it
    // lands in the measurement-only tier rather than unknown-unverified —
    // demonstrating the tier is doing real classification work here, not
    // just falling through.
    expect(classifyReturnPortalTrust("https://thecommense.com/pages/return-policy", "COMMENSE", "web_lookup")).toBe(
      "web-lookup-sourced",
    );
  });

  it("classifies unknown-unverified for a real click-tracking/ESP redirect that matches neither list", () => {
    // Real shape observed in production: a SendGrid click-tracking link for
    // a genuine Gap Inc. email — entirely legitimate, but neither the
    // retailer's own domain nor a known return-portal provider. Correctly a
    // SIGNAL (one review glance), never a block.
    expect(
      classifyReturnPortalTrust(
        "https://u24515401.ct.sendgrid.net/ls/click?upn=abc",
        "Gap Inc.",
        "stated_in_email",
      ),
    ).toBe("unknown-unverified");
  });

  it("fails safe (unknown-unverified), never toward trust, on an unparseable URL", () => {
    expect(classifyReturnPortalTrust("not a url", "Nordstrom", "stated_in_email")).toBe("unknown-unverified");
  });
});

// ── notesIndicateTieredWindow (tiered return policy detection — FALLBACK path) ─
// Real bug: Moda Operandi states "30 days for full-priced items, 14 days for
// discounted items and for cash-refund-vs-site-credit" — the AI picked 30 with
// an active rationale ("the longer window is reported here"), producing a
// deadline 16 days after the true window closes for a common case. The
// original fix (2026-07-08 morning) was a prompt rule (always pick the
// shortest stated window) plus this notes-string-match detection.
//
// As of 2026-07-08 afternoon, this is no longer the PRIMARY needsReview
// signal — a live production check found the AI's non-deterministic notes
// capitalization ("multiple" vs "Multiple") could silently defeat a
// case-sensitive match. needsReview is now a first-class field the AI sets
// directly (see computeNeedsReview below); this function is kept as a
// belt-and-suspenders FALLBACK for one release cycle, not removed. These
// tests still cover that fallback path directly — extractEmail() can't call
// the real Anthropic API in a unit test, so this tests the actual pure
// function, not a mocked end-to-end extraction.

describe("notesIndicateTieredWindow (fallback path)", () => {
  it("detects the exact marker the tiered-window prompt rule specifies (the Moda Operandi shape)", () => {
    const notes =
      "Multiple return windows detected: 30 days for full-priced items, 14 days for discounted items and for cash-refund-vs-site-credit. Selected shortest (14 days) per policy.";
    expect(notesIndicateTieredWindow(notes)).toBe(true);
  });

  it("still detects the marker after being appended to prior notes text (matches extractEmail's concatenation)", () => {
    const notes = `Order total read directly from the email. ${TIERED_WINDOW_NOTE_MARKER}: 30 days full-price, 14 days sale. Selected shortest (14 days) per policy.`;
    expect(notesIndicateTieredWindow(notes)).toBe(true);
  });

  it("returns false for ordinary extraction notes with no tiering", () => {
    expect(notesIndicateTieredWindow("Order total read directly from the email.")).toBe(false);
  });

  it("returns false for an empty notes string", () => {
    expect(notesIndicateTieredWindow("")).toBe(false);
  });
});

// ── computeNeedsReview (PRIMARY path, as of 2026-07-08 afternoon) ────────────
// The AI now sets needsReview directly in its own JSON output (both the
// email-body and web-lookup paths) instead of it being purely derived from a
// notes string match. This is the actual pure function extractEmail() calls
// — proves the AI's own flag drives the result, with the existing JS-side
// triggers and the notesIndicateTieredWindow fallback still contributing.

describe("computeNeedsReview", () => {
  const base = {
    aiNeedsReview: false,
    lookupNeedsReview: false,
    confidence: "high" as const,
    emailType: "order_confirmation" as const,
    retailer: "Moda Operandi",
    orderNumber: "456603272478",
    returnDeadline: "2026-08-01T00:00:00.000Z",
    policyLookupWasUnclear: false,
    notes: "Order total read directly from the email.",
  };

  it("is true when the AI sets needsReview directly, with no tiered-notes marker and no other trigger — the primary path", () => {
    expect(computeNeedsReview({ ...base, aiNeedsReview: true })).toBe(true);
  });

  it("is true when the AI sets needsReview: false but notes still contain the tiered-window marker — the fallback catches what the AI's own flag missed", () => {
    const notes =
      "Multiple return windows detected: 30 days full-price, 14 days sale. Selected shortest (14 days) per policy.";
    expect(computeNeedsReview({ ...base, aiNeedsReview: false, notes })).toBe(true);
  });

  it("is true when the web-lookup path's own needsReview flag is set, independent of the email-body flag", () => {
    expect(computeNeedsReview({ ...base, aiNeedsReview: false, lookupNeedsReview: true })).toBe(true);
  });

  it("is false when nothing — AI flag, lookup flag, JS-side triggers, or notes marker — indicates review is needed", () => {
    expect(computeNeedsReview({ ...base })).toBe(false);
  });

  it("existing JS-side triggers still contribute independent of the AI's flag (low confidence)", () => {
    expect(computeNeedsReview({ ...base, aiNeedsReview: false, confidence: "low" })).toBe(true);
  });

  it("existing JS-side triggers still contribute independent of the AI's flag (missing deadline on order_confirmation)", () => {
    expect(computeNeedsReview({ ...base, aiNeedsReview: false, returnDeadline: null })).toBe(true);
  });
});

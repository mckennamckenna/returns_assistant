import { describe, it, expect } from "vitest";
import { parseTracking, parseTrackingResolved } from "../lib/trackingParser";

describe("parseTracking", () => {
  // ── UPS ───────────────────────────────────────────────────────────────────
  it("detects a UPS tracking number in plain text", () => {
    const result = parseTracking("Your UPS tracking: 1Z999AA10123456784", null);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1Z999AA10123456784");
    expect(result.trackingUrl).toContain("ups.com/track");
  });

  it("is case-insensitive for UPS '1Z' prefix", () => {
    const result = parseTracking("1z999AA10123456784", null);
    expect(result.carrier).toBe("UPS");
  });

  // ── USPS ──────────────────────────────────────────────────────────────────
  it("detects a USPS tracking number (22 digits starting with 94)", () => {
    const result = parseTracking("USPS: 9400111899223397828227", null);
    expect(result.carrier).toBe("USPS");
    expect(result.trackingNumber).toBe("9400111899223397828227");
    expect(result.trackingUrl).toContain("usps.com");
  });

  // ── FedEx ─────────────────────────────────────────────────────────────────
  it("detects a 12-digit FedEx tracking number in plain text", () => {
    const result = parseTracking("FedEx tracking: 123456789012", null);
    expect(result.carrier).toBe("FedEx");
    expect(result.trackingNumber).toBe("123456789012");
    expect(result.trackingUrl).toContain("fedex.com");
  });

  it("detects a 15-digit FedEx tracking number in plain text", () => {
    const result = parseTracking("Your shipment: 123456789012345", null);
    expect(result.carrier).toBe("FedEx");
    expect(result.trackingNumber).toBe("123456789012345");
  });

  // ── DHL ───────────────────────────────────────────────────────────────────
  it("detects an 11-digit DHL tracking number in plain text", () => {
    const result = parseTracking("DHL waybill: 12345678901", null);
    expect(result.carrier).toBe("DHL");
    expect(result.trackingNumber).toBe("12345678901");
    expect(result.trackingUrl).toContain("dhl.com");
  });

  // ── Amazon Logistics ─────────────────────────────────────────────────────
  it("detects an Amazon Logistics TBA tracking number in plain text", () => {
    const result = parseTracking("Your package is on its way: TBA305477112000", null);
    expect(result.carrier).toBe("Amazon Logistics");
    expect(result.trackingNumber).toBe("TBA305477112000");
    expect(result.trackingUrl).toContain("track.amazon.com");
  });

  it("also matches TBM/TBC Amazon Logistics prefixes", () => {
    expect(parseTracking("TBM305477112000", null).carrier).toBe("Amazon Logistics");
    expect(parseTracking("TBC305477112000", null).carrier).toBe("Amazon Logistics");
  });

  // ── OnTrac ────────────────────────────────────────────────────────────────
  it("detects an OnTrac tracking number (letter + 14 digits) in plain text", () => {
    const result = parseTracking("OnTrac: C12345678901234", null);
    expect(result.carrier).toBe("OnTrac");
    expect(result.trackingNumber).toBe("C12345678901234");
    expect(result.trackingUrl).toContain("ontrac.com");
  });

  // ── LaserShip ─────────────────────────────────────────────────────────────
  it("detects a LaserShip '1LS'-prefixed tracking number in plain text", () => {
    const result = parseTracking("LaserShip tracking: 1LSCYM1000AIBES", null);
    expect(result.carrier).toBe("LaserShip");
    expect(result.trackingNumber).toBe("1LSCYM1000AIBES");
    expect(result.trackingUrl).toContain("lasership.com");
  });

  // ── UniUni ────────────────────────────────────────────────────────────────
  it("detects a UniUni 'UUS'-prefixed tracking number in plain text", () => {
    const result = parseTracking("UniUni: UUS0570455416253", null);
    expect(result.carrier).toBe("UniUni");
    expect(result.trackingNumber).toBe("UUS0570455416253");
    expect(result.trackingUrl).toContain("uniuni.com");
  });

  // ── Veho (domain-only — no public number format) ────────────────────────
  it("detects Veho from a tracking URL but leaves trackingNumber null", () => {
    const html = `<a href="https://www.shipveho.com/track/91f5baadefb732585">Track</a>`;
    const result = parseTracking(null, html);
    expect(result.carrier).toBe("Veho");
    expect(result.trackingUrl).toContain("shipveho.com");
    expect(result.trackingNumber).toBeNull();
  });

  it("never claims a Veho carrier from plain text alone", () => {
    const result = parseTracking("Veho tracking: 91f5baadefb732585", null);
    expect(result.carrier).toBeNull();
  });

  // ── AxleHire (domain-only — no public number format) ────────────────────
  it("detects AxleHire from a tracking URL but leaves trackingNumber null", () => {
    const html = `<a href="https://www.axlehire.com/tracking?trackingId=5y4slr4phjhm2x5">Track</a>`;
    const result = parseTracking(null, html);
    expect(result.carrier).toBe("AxleHire");
    expect(result.trackingUrl).toContain("axlehire.com");
    expect(result.trackingNumber).toBeNull();
  });

  it("never claims an AxleHire carrier from plain text alone", () => {
    const result = parseTracking("AxleHire tracking: 5y4slr4phjhm2x5", null);
    expect(result.carrier).toBeNull();
  });

  // ── URL-based detection ───────────────────────────────────────────────────
  it("detects a UPS tracking URL from an HTML href", () => {
    const html = `<a href="https://www.ups.com/track?tracknum=1Z999AA10123456784">Track</a>`;
    const result = parseTracking(null, html);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingUrl).toContain("ups.com/track");
    expect(result.trackingNumber).toBe("1Z999AA10123456784");
  });

  it("detects a FedEx tracking URL from an HTML href", () => {
    const html = `<a href="https://www.fedextrack.com/status/en/english?tracknumbers=123456789012">Track your FedEx package</a>`;
    const result = parseTracking(null, html);
    expect(result.carrier).toBe("FedEx");
    expect(result.trackingUrl).toContain("fedex");
  });

  it("detects a USPS tracking URL from an HTML href (TrackConfirmAction format)", () => {
    const html = `<a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223397828227">Track with USPS</a>`;
    const result = parseTracking(null, html);
    expect(result.carrier).toBe("USPS");
    expect(result.trackingUrl).toContain("usps.com");
    expect(result.trackingNumber).toBe("9400111899223397828227");
  });

  // ── URL wins over plain-text when both present ───────────────────────────
  it("prefers URL-based detection over plain-text when HTML contains a tracking link", () => {
    // HTML has a UPS link; text has a FedEx number — URL must win.
    const html = `<a href="https://www.ups.com/track?tracknum=1Z999AA10123456784">Track</a>`;
    const text = "FedEx: 123456789012";
    const result = parseTracking(text, html);
    expect(result.carrier).toBe("UPS");
  });

  // ── Nothing found ─────────────────────────────────────────────────────────
  it("returns all-null when no tracking info is present", () => {
    const result = parseTracking("Order confirmed. No tracking yet.", "<p>Thanks for your order!</p>");
    expect(result.carrier).toBeNull();
    expect(result.trackingNumber).toBeNull();
    expect(result.trackingUrl).toBeNull();
  });

  it("returns all-null when both inputs are null", () => {
    const result = parseTracking(null, null);
    expect(result.carrier).toBeNull();
    expect(result.trackingNumber).toBeNull();
    expect(result.trackingUrl).toBeNull();
  });
});

// 2026-09-04 outbound diagnostic (docs/audits/2026-09-04-outbound-diagnostic.md):
// 2 confirmed real orders had a tracking number sitting as an <a> tag's
// VISIBLE link text — invisible to parseTracking() because its plain-text
// phase never receives htmlBody as text when textBody is empty, and the
// href itself pointed at a non-carrier redirect domain (EasyPost), so the
// href-domain scan (phase 1) never matched either. Fixtures below reproduce
// that shape with fabricated numbers/tokens/dates — no real order numbers,
// customer names, addresses, or EasyPost tokens from the source emails.
describe("parseTrackingResolved", () => {
  it("finds a tracking number sitting as visible HTML link text behind a non-carrier redirect href, when textBody is empty", () => {
    const html = `
      <p>We received notice that your return was shipped via UPS on a recent date. You can track your package at any time using the link below.</p>
      <p>UPS tracking number: <a href="https://track.easypost.com/some-opaque-token">1ZAAA0000000000001</a></p>
    `;
    const result = parseTrackingResolved("", html);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1ZAAA0000000000001");
    expect(result.trackingUrl).toContain("ups.com/track");
  });

  it("finds a second, differently-shaped confirmed case (another retailer, same underlying gap)", () => {
    const html = `
      <table><tr><td>
        <p>Your return is on its way back to us.</p>
        <p>Carrier: UPS — <a href="https://track.easypost.com/another-opaque-token">1ZBBB1111111111112</a></p>
      </td></tr></table>
    `;
    const result = parseTrackingResolved(null, html);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1ZBBB1111111111112");
  });

  it("does NOT find a number that's only in a redirect href, when there's no visible link text to fall back to (parity with parseTracking)", () => {
    const html = `<p>Track your return <a href="https://track.easypost.com/some-opaque-token">here</a>.</p>`;
    const result = parseTrackingResolved("", html);
    expect(result.carrier).toBeNull();
    expect(result.trackingNumber).toBeNull();
  });

  it("regression: prefers a substantial textBody's real number over misleading content in htmlBody", () => {
    const textBody = "Your return has shipped. UPS tracking number: 1ZCCC2222222222223. ".repeat(2);
    const htmlBody = `<p>Unrelated marketing content mentioning a different carrier and number: FedEx 999999999999.</p>`;
    const result = parseTrackingResolved(textBody, htmlBody);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1ZCCC2222222222223");
  });

  it("falls back to htmlBody exactly like resolveBodyText does, when textBody is present but too thin to count as substantial", () => {
    const textBody = "Hi"; // well under MIN_TEXT_BODY_CHARS
    const htmlBody = `<p>UPS tracking number: <a href="https://track.easypost.com/token">1ZDDD3333333333334</a></p>`;
    const result = parseTrackingResolved(textBody, htmlBody);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1ZDDD3333333333334");
  });

  it("returns all-null when neither body has anything, same as parseTracking", () => {
    const result = parseTrackingResolved(null, null);
    expect(result.carrier).toBeNull();
    expect(result.trackingNumber).toBeNull();
    expect(result.trackingUrl).toBeNull();
  });

  it("still prefers a direct carrier-domain href over resolved text (phase 1 unaffected)", () => {
    const html = `<a href="https://www.ups.com/track?tracknum=1Z999AA10123456784">Track</a>`;
    const result = parseTrackingResolved("", html);
    expect(result.carrier).toBe("UPS");
    expect(result.trackingNumber).toBe("1Z999AA10123456784");
  });
});

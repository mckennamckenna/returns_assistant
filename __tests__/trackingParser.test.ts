import { describe, it, expect } from "vitest";
import { parseTracking } from "../lib/trackingParser";

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

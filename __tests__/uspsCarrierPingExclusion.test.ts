import { describe, it, expect } from "vitest";
import { USPS_CARRIER_DOMAIN, isUspsCarrierDomain } from "../lib/uspsCarrierPingExclusion";

describe("isUspsCarrierDomain", () => {
  it("matches the enumerated domain", () => {
    expect(isUspsCarrierDomain(USPS_CARRIER_DOMAIN)).toBe(true);
    expect(isUspsCarrierDomain("tracking.usps.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isUspsCarrierDomain("Tracking.USPS.com")).toBe(true);
  });

  it("matches a subdomain", () => {
    expect(isUspsCarrierDomain("mail.tracking.usps.com")).toBe(true);
  });

  it("does NOT match the bare usps.com domain — only the tracking-notification subdomain observed in real data", () => {
    expect(isUspsCarrierDomain("usps.com")).toBe(false);
  });

  it("does NOT match an unrelated carrier or retailer domain", () => {
    expect(isUspsCarrierDomain("ups.com")).toBe(false);
    expect(isUspsCarrierDomain("fedex.com")).toBe(false);
    expect(isUspsCarrierDomain("mango.com")).toBe(false);
  });

  it("does NOT match a domain that merely contains it as a substring, not a suffix", () => {
    expect(isUspsCarrierDomain("nottracking.usps.com")).toBe(false);
    expect(isUspsCarrierDomain("tracking.usps.com.evil.com")).toBe(false);
  });
});

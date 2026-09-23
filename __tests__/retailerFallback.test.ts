import { describe, it, expect } from "vitest";
import {
  resolveRetailerFallback,
  registeredDomain,
  CARRIER_DOMAINS,
  CARRIER_DOMAIN_NAMES,
  isCarrierSender,
  GENERIC_FROM_NAMES,
} from "../lib/retailerFallback";

// ZARA_RETAILER_FALLBACK (2026-08-25). Pure-function coverage of Decision 3
// (amended) — the same shape as extract.test.ts's coverage of extract.ts's
// small pure helpers (see that file's own comment on why finalizeExtraction/
// extractEmail's branches aren't unit-tested directly: they'd require
// mocking the Anthropic SDK). This function has no such dependency, so it's
// tested directly rather than only through runExtraction.test.ts's
// integration coverage.

describe("resolveRetailerFallback", () => {
  it("Zara case: fromName 'Zara' resolves via Step 1", () => {
    expect(resolveRetailerFallback("noreply@zara.com", "Zara")).toEqual({
      retailer: "Zara",
      retailerSource: "sender_fallback",
      carrier: null,
    });
  });

  it("generic fromName case: fromName 'noreply' is an exact generic match -- falls through Step 1 to Step 2 (domain), still resolves 'Zara'", () => {
    expect(resolveRetailerFallback("noreply@zara.com", "noreply")).toEqual({
      retailer: "Zara",
      retailerSource: "sender_fallback",
      carrier: null,
    });
  });

  it("ESP subdomain: orders@email.bloomingdales.com strips the 'email.' prefix before taking the registered domain", () => {
    expect(resolveRetailerFallback("orders@email.bloomingdales.com", null)).toEqual({
      retailer: "Bloomingdales",
      retailerSource: "sender_fallback",
      carrier: null,
    });
  });

  it("carrier case (FedEx): Step 0 fires before fromName is ever considered -- must NOT resolve to 'FedEx Delivery Manager'", () => {
    expect(resolveRetailerFallback("TrackingUpdates@fedex.com", "FedEx Delivery Manager")).toEqual({
      retailer: null,
      retailerSource: "carrier_deferred",
      carrier: "FedEx",
    });
  });

  it("carrier case (USPS, subdomain): tracking.usps.com reduces to registered domain usps.com -- must NOT resolve to 'USPS Tracking'", () => {
    expect(resolveRetailerFallback("auto-reply@tracking.usps.com", "USPS Tracking")).toEqual({
      retailer: null,
      retailerSource: "carrier_deferred",
      carrier: "USPS",
    });
  });

  it("fromName present and NOT an exact generic match, even though it contains a generic word, is used as-is (Step 1's exact-match rule, by design)", () => {
    // Documents the known, intentional boundary: this is exactly why Step 0
    // (carrier domain check) has to run FIRST -- a fromName-contains-a-
    // generic-word heuristic was rejected in favor of a domain-based gate,
    // per the Step 1a enumeration findings (commit 5fbc968).
    expect(resolveRetailerFallback("hello@somebrand.com", "Somebrand Delivery Manager")).toEqual({
      retailer: "Somebrand Delivery Manager",
      retailerSource: "sender_fallback",
      carrier: null,
    });
  });

  it("both fromName and fromEmail empty: nothing resolves, retailer and retailerSource both stay null -- never invents a value", () => {
    expect(resolveRetailerFallback("", null)).toEqual({
      retailer: null,
      retailerSource: null,
      carrier: null,
    });
  });

  it("CARRIER_DOMAINS covers the full starting list from the approved design", () => {
    expect([...CARRIER_DOMAINS].sort()).toEqual(
      ["dhl.com", "fedex.com", "lasership.com", "ontrac.com", "ups.com", "usps.com"].sort(),
    );
  });

  it("registeredDomain strips known ESP prefixes and reduces to the last two labels", () => {
    expect(registeredDomain("tracking.usps.com")).toBe("usps.com");
    expect(registeredDomain("email.bloomingdales.com")).toBe("bloomingdales.com");
    expect(registeredDomain("noreply@zara.com".split("@")[1])).toBe("zara.com");
  });

  it("GENERIC_FROM_NAMES is exact-match only -- 'FedEx Delivery Manager' is not itself in the set", () => {
    expect(GENERIC_FROM_NAMES.has("delivery manager")).toBe(true);
    expect(GENERIC_FROM_NAMES.has("fedex delivery manager")).toBe(false);
  });

  // Carrier-row-disposition Phase 1 (2026-08-28).
  it.each(Object.entries(CARRIER_DOMAIN_NAMES))(
    "carrier name mapping: a sender on %s resolves carrier %j",
    (domain, name) => {
      const result = resolveRetailerFallback(`tracking@${domain}`, null);
      expect(result.carrier).toBe(name);
    },
  );

  it("atomicity guarantee: carrier is non-null iff retailerSource is 'carrier_deferred', in both directions", () => {
    const carrierInputs = Object.keys(CARRIER_DOMAIN_NAMES).map(
      (domain) => resolveRetailerFallback(`tracking@${domain}`, null),
    );
    for (const result of carrierInputs) {
      expect(result.retailerSource).toBe("carrier_deferred");
      expect(result.carrier).not.toBeNull();
    }

    const nonCarrierResult = resolveRetailerFallback("noreply@zara.com", "Zara");
    expect(nonCarrierResult.retailerSource).not.toBe("carrier_deferred");
    expect(nonCarrierResult.carrier).toBeNull();
  });

  // Regression guard for the 2026-09-22 helper extraction (root cause (a)):
  // Step 0's inline CARRIER_DOMAINS.has(registered) was replaced by the
  // shared isCarrierSender() so the policy-lookup gate in lib/extract.ts
  // can ask the same question against the same list. Step 0's behavior
  // must be byte-for-byte what it was — every domain that deferred before
  // still defers, including via an ESP prefix and a tracking subdomain.
  it("Step 0 still defers for EVERY carrier domain after the isCarrierSender extraction", () => {
    for (const domain of Object.keys(CARRIER_DOMAIN_NAMES)) {
      const direct = resolveRetailerFallback(`tracking@${domain}`, "Some Shop");
      expect(direct.retailerSource).toBe("carrier_deferred");
      expect(direct.retailer).toBeNull();
      expect(direct.carrier).toBe(CARRIER_DOMAIN_NAMES[domain]);

      // Subdomain form (tracking.usps.com -> usps.com) must defer too — a
      // real shape in production data.
      const sub = resolveRetailerFallback(`noreply@tracking.${domain}`, "Some Shop");
      expect(sub.retailerSource).toBe("carrier_deferred");
    }
  });
});

describe("isCarrierSender", () => {
  // The predicate the policy-lookup gate depends on. It answers a question
  // about the ENVELOPE only; it deliberately knows nothing about what the
  // body named as the retailer, which is what makes it usable at the gate
  // where resolveRetailerFallback is not (that only runs when body
  // extraction found no retailer at all).
  it("is true for every carrier domain, in direct and subdomain form", () => {
    for (const domain of CARRIER_DOMAINS) {
      expect(isCarrierSender(`tracking@${domain}`)).toBe(true);
      expect(isCarrierSender(`noreply@tracking.${domain}`)).toBe(true);
    }
  });

  it("is false for retailer and ESP senders", () => {
    expect(isCarrierSender("noreply@zara.com")).toBe(false);
    expect(isCarrierSender("orders@email.bloomingdales.com")).toBe(false);
    expect(isCarrierSender("us@delivery.hm.com")).toBe(false);
  });

  it("agrees with Step 0 on every input: carrier iff carrier_deferred", () => {
    const inputs = [
      "pkginfo@ups.com",
      "noreply@tracking.usps.com",
      "shipment@fedex.com",
      "noreply@zara.com",
      "orders@email.bloomingdales.com",
      "us@delivery.hm.com",
    ];
    for (const from of inputs) {
      const deferred = resolveRetailerFallback(from, null).retailerSource === "carrier_deferred";
      expect(isCarrierSender(from)).toBe(deferred);
    }
  });
});

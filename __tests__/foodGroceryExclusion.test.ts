import { describe, it, expect } from "vitest";
import {
  FOOD_GROCERY_SENDER_DOMAINS,
  AMAZON_FOOD_RETAILER_NAMES,
  extractDomain,
  isFoodGroceryDomain,
  isFoodGroceryRetailer,
} from "../lib/foodGroceryExclusion";

describe("extractDomain", () => {
  it("extracts the domain from an email address", () => {
    expect(extractDomain("orders@doordash.com")).toBe("doordash.com");
  });

  it("lowercases the result", () => {
    expect(extractDomain("Orders@DoorDash.COM")).toBe("doordash.com");
  });

  it("returns an empty string when there's no @", () => {
    expect(extractDomain("not-an-email")).toBe("");
  });
});

describe("isFoodGroceryDomain", () => {
  it.each(FOOD_GROCERY_SENDER_DOMAINS)("matches the enumerated domain %s", (domain) => {
    expect(isFoodGroceryDomain(domain)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFoodGroceryDomain("DoorDash.com")).toBe(true);
    expect(isFoodGroceryDomain("GOODEGGS.COM")).toBe(true);
  });

  it("matches a subdomain of an enumerated domain", () => {
    expect(isFoodGroceryDomain("order.doordash.com")).toBe(true);
  });

  it("does NOT match an unrelated retailer domain", () => {
    expect(isFoodGroceryDomain("amazon.com")).toBe(false);
    expect(isFoodGroceryDomain("mango.com")).toBe(false);
  });

  it("does NOT match an Amazon subdomain — dot-boundary matching, not substring; the sender-domain layer must never catch real Amazon (that's the retailer-name backstop's job)", () => {
    expect(isFoodGroceryDomain("mail.amazon.com")).toBe(false);
    expect(isFoodGroceryDomain("email.amazon.com")).toBe(false);
    expect(isFoodGroceryDomain("order-update.amazon.com")).toBe(false);
  });

  it("does NOT match a domain that merely contains an enumerated domain as a substring, not a suffix", () => {
    expect(isFoodGroceryDomain("notdoordash.com")).toBe(false);
    expect(isFoodGroceryDomain("doordash.com.evil.com")).toBe(false);
  });
});

describe("isFoodGroceryRetailer", () => {
  it.each(AMAZON_FOOD_RETAILER_NAMES)("matches the enumerated retailer name %s", (retailer) => {
    expect(isFoodGroceryRetailer(retailer)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFoodGroceryRetailer("amazon fresh")).toBe(true);
    expect(isFoodGroceryRetailer("WHOLE FOODS MARKET")).toBe(true);
  });

  it("does NOT match plain Amazon — the general marketplace, not a food service", () => {
    expect(isFoodGroceryRetailer("Amazon")).toBe(false);
    expect(isFoodGroceryRetailer("Amazon.com")).toBe(false);
  });

  it("does NOT match null or an unrelated retailer", () => {
    expect(isFoodGroceryRetailer(null)).toBe(false);
    expect(isFoodGroceryRetailer("Mango")).toBe(false);
  });
});

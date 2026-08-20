// Food + grocery delivery exclusion (category-level) — TASKS.md 🔴 Now,
// scoped 2026-08-18. Named constants + matchers shared by three call sites:
// the sender-domain pre-junk in shouldAutoJunk (lib/junk.ts, at ingestion,
// before Haiku/Sonnet — the cost win, matched senders never reach either
// billed call), the retailer-name backstop in linkEmailToOrder
// (lib/linkOrder.ts, post-extraction — Amazon Fresh / Whole Foods Market
// share Amazon's generic order-update@amazon.com sender, so they can't be
// caught by domain without also catching every real Amazon order), and the
// lookupReturnPolicy skip-gate in extractEmail (lib/extract.ts — avoids a
// redundant billed policy lookup on an email that's about to be junked one
// step later anyway).

export const FOOD_GROCERY_SENDER_DOMAINS = [
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "instacart.com",
  "postmates.com",
  "caviar.com",
  "wholefoodsmarket.com",
  "goodeggs.com",
] as const;

export const AMAZON_FOOD_RETAILER_NAMES = ["Amazon Fresh", "Whole Foods Market"] as const;

export function extractDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

// Case-insensitive; matches the bare domain or any subdomain of it
// (e.g. "order.doordash.com" still matches "doordash.com").
export function isFoodGroceryDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return FOOD_GROCERY_SENDER_DOMAINS.some((d) => normalized === d || normalized.endsWith(`.${d}`));
}

export function isFoodGroceryRetailer(retailer: string | null): boolean {
  if (!retailer) return false;
  const normalized = retailer.toLowerCase();
  return AMAZON_FOOD_RETAILER_NAMES.some((r) => r.toLowerCase() === normalized);
}

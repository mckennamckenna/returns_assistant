// USPS carrier-ping exclusion — TASKS.md 🔴 Now, needs-review bucket
// rebuild, 2026-08-21. Same layer/pattern as
// lib/foodGroceryExclusion.ts's sender-domain pre-junk (checked in
// shouldAutoJunk, lib/junk.ts, before the Haiku/Sonnet calls both run —
// the same cost win), kept as its own module rather than folded into that
// one since it's a different exclusion reason (a carrier-status ping, not
// a purchase category) with its own rationale.
//
// Census this session (63 live email-kind bucket rows, all users): exactly
// 6 tracking.usps.com rows, all a generic "USPS® Expected Delivery on
// {date}..." template with no return-policy/order-total data and an
// unreliable-or-absent retailer name even when extraction succeeds — the
// content has ~no return-tracking value to lose by excluding it. Unlike
// food/grocery's blanket category exclusion, this isn't "we don't want to
// track this kind of purchase" — it's "a bare USPS status ping is never the
// useful record of a purchase, so excluding it by domain costs nothing even
// in the case where it's technically the only email that arrived."
export const USPS_CARRIER_DOMAIN = "tracking.usps.com";

// Case-insensitive; matches the bare domain or any subdomain of it, same
// convention as isFoodGroceryDomain.
export function isUspsCarrierDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return normalized === USPS_CARRIER_DOMAIN || normalized.endsWith(`.${USPS_CARRIER_DOMAIN}`);
}

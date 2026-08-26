// Sender-derived retailer fallback — ZARA_RETAILER_FALLBACK, 2026-08-25.
// Fires only when body extraction (lib/extract.ts's buildPrompt(), which
// deliberately never reads the From header — see extract.ts:207) returns a
// null retailer on a commerce-typed email. Shared between the runtime
// extraction path (lib/extract.ts) and scripts/backfill-carrier-deferred-
// 20260825.ts so the two can never drift apart on what counts as a carrier
// domain or a generic sender name — verified against real data in
// ZARA_DIAGNOSTIC_FINDINGS_BACKFILL_RADIUS_20260825.md and the Step 1a/1b/1c
// enumeration (scripts/pm-verify-zara-fallback-enumeration-20260825.ts,
// commit 5fbc968).

// Decision 2, condition (ii) — the gate this fallback is only ever
// considered under. Carrier-tracking emails (FedEx/USPS/etc.) commonly
// carry these same emailType values, which is exactly why Step 0 below
// exists — this list alone does not exclude them.
export const RETAILER_FALLBACK_GATE_EMAIL_TYPES = new Set([
  "order_confirmation", "shipping_confirmation", "delivery", "return_label", "refund",
]);

// Decision 3 (amended), Step 0 — carrier/logistics sender domains, checked
// before anything else. A sender-derived retailer for one of these would
// mislabel a tracking notification as "sold by FedEx" — confirmed against
// real data (5 of 8 rows in the initial diagnostic population) worse than
// leaving retailer null. Extend only from real data, not speculatively.
export const CARRIER_DOMAINS = new Set([
  "fedex.com", "usps.com", "ups.com", "dhl.com", "ontrac.com", "lasership.com",
]);

// Decision 3, Step 1 — exact match only, case-insensitive. A fromName that
// merely CONTAINS one of these words (e.g. "FedEx Delivery Manager") does
// NOT match here — that's what Step 0's carrier-domain check is for.
export const GENERIC_FROM_NAMES = new Set([
  "noreply", "no-reply", "hello", "team", "support", "orders", "notifications",
  "info", "contact", "service", "customer service", "delivery manager",
  "tracking", "updates",
]);

// Decision 3, Step 2 — stripped before taking the registered domain.
const ESP_SUBDOMAIN_PREFIXES = ["email.", "mktg.", "send.", "mail."];

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email.toLowerCase() : email.slice(at + 1).toLowerCase();
}

// "Registered domain" per Decision 3: strip a known ESP subdomain prefix if
// present, then take the last two dot-separated labels
// (tracking.usps.com -> usps.com; email.bloomingdales.com -> bloomingdales.com).
export function registeredDomain(domain: string): string {
  let d = domain;
  for (const prefix of ESP_SUBDOMAIN_PREFIXES) {
    if (d.startsWith(prefix)) {
      d = d.slice(prefix.length);
      break;
    }
  }
  const parts = d.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : d;
}

function titleCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface RetailerFallbackResult {
  retailer: string | null;
  // null here (Step 3/4, nothing resolved) is a deliberate choice, not an
  // oversight: retailerSource describes WHY retailer has its current value
  // (a resolved source, or a deliberate carrier-deferred null) — when
  // nothing resolves, there is no source to record, so it stays null
  // rather than being marked 'body_extraction' (which would misrepresent
  // where the null came from).
  retailerSource: "sender_fallback" | "carrier_deferred" | null;
}

// Applies Decision 3 (amended) precedence. Caller is responsible for
// Decision 2's full gate (extractedAt IS NOT NULL, retailer IS NULL,
// emailType in RETAILER_FALLBACK_GATE_EMAIL_TYPES) — this function only
// computes what the fallback WOULD resolve to, given sender fields already
// known to be eligible.
export function resolveRetailerFallback(fromEmail: string, fromName: string | null): RetailerFallbackResult {
  const domain = domainOf(fromEmail);
  const registered = registeredDomain(domain);

  // Step 0 — carrier deferral.
  if (CARRIER_DOMAINS.has(registered)) {
    return { retailer: null, retailerSource: "carrier_deferred" };
  }

  // Step 1 — fromName, if present and not an exact generic match.
  const trimmedName = (fromName ?? "").trim();
  if (trimmedName.length > 0 && !GENERIC_FROM_NAMES.has(trimmedName.toLowerCase())) {
    return { retailer: trimmedName, retailerSource: "sender_fallback" };
  }

  // Step 2 — domain-derived.
  if (registered) {
    return { retailer: titleCase(registered.split(".")[0]), retailerSource: "sender_fallback" };
  }

  // Step 3 — override map. START EMPTY per design; add entries here only
  // once real data shows Steps 0-2 producing a wrong result.

  // Step 4 — nothing resolved.
  return { retailer: null, retailerSource: null };
}

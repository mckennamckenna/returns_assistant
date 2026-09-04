# Where retailer identity lives

Two models carry a `retailer` field. Neither has any normalization, canonicalization,
or lookup-table logic applied to it on write. Both are plain freeform strings.

## `Email.retailer` (prisma/schema.prisma, model `Email`, around line 119)

```prisma
// --- Milestone 2 additions ---
retailer            String?
// Provenance for `retailer` — mirrors the policySource pattern below.
// "body_extraction" (AI read it from the email body, the normal case) |
// "sender_fallback" (body extraction returned null; resolved from
// fromName/fromEmail domain instead — ZARA_RETAILER_FALLBACK, 2026-08-25) |
// "carrier_deferred" (sender is a known carrier/logistics domain, e.g.
// FedEx/USPS — retailer deliberately left null, not sold-by-carrier) |
// null (never extracted, or extracted before this column existed).
retailerSource      String?
```

`retailer` is nullable freeform text with no length cap, no enum, no FK. Its only
documented structure is the `retailerSource` provenance enum next to it (see
derivation.md for what each value actually means in practice).

## `Order.retailer` (prisma/schema.prisma, model `Order`, around line 233)

```prisma
retailer    String?
orderNumber String?
```

No doc comment on `Order.retailer` at all — it's just declared alongside `orderNumber`.
No provenance field parallel to `Email.retailerSource` exists at the Order level.

## Normalization on write — none found

A thorough grep across `lib/*.ts` for `retailer` (see the derivation.md trace) turned up
zero normalization functions applied to the *value* of a retailer name — no lowercasing,
no legal-suffix stripping (no "Inc"/"LLC"/"USA" trimming), no canonicalization against a
known-retailer list, anywhere in the write path. What exists instead are three unrelated,
narrower mechanisms, easy to mistake for normalization but not:

1. **`lib/linkOrder.ts`'s `isRetailerPrefixMatch`** (line 493) — used only for *order
   matching* (deciding whether an incoming email belongs to an existing Order), not for
   producing a clean display/query name:
   ```ts
   export function isRetailerPrefixMatch(a: string, b: string): boolean {
     const lowerA = a.toLowerCase();
     const lowerB = b.toLowerCase();
     const shorter = lowerA.length <= lowerB.length ? lowerA : lowerB;
     const longer = lowerA.length <= lowerB.length ? lowerB : lowerA;
     return shorter.length >= MIN_RETAILER_PREFIX_LENGTH && longer.startsWith(shorter);
   }
   ```
   This lowercases and prefix-compares two strings to decide "are these probably the
   same retailer" (e.g. "Proenza" vs "Proenza Schouler") for merge purposes. It never
   writes a canonical value anywhere — whichever email created the Order keeps its
   raw string forever (see derivation.md).

2. **`lib/extract.ts`'s `normalizeForDomainMatch`** (line 446) — used only to check
   whether a `returnPortalUrl`'s domain matches the retailer's own name (for
   `classifyReturnPortalTrust`'s `"retailer-own-domain"` tier), not to normalize the
   stored retailer string itself:
   ```ts
   function normalizeForDomainMatch(s: string): string {
     return s.toLowerCase().replace(/[^a-z0-9]/g, "");
   }
   ```

3. **`lib/retailerFallback.ts`'s `titleCase`** (line 71) — applied only when Step 2 of
   the sender-fallback path derives a retailer name from a bare email domain (e.g.
   `zara.com` → `"Zara"`); it does not touch retailer values that came from body
   extraction (the vast majority — see derivation.md) or from Step 1 (verbatim
   `fromName`).

## Dedicated retailer table / lookup — none found

No `RetailerAlias`, `Retailer`, or similar model exists in `prisma/schema.prisma`. No
static lookup map (comparable to `lib/retailerFallback.ts`'s `CARRIER_DOMAIN_NAMES`, or
`lib/extract.ts`'s `KNOWN_THIRD_PARTY_PORTAL_DOMAINS` allowlist) maps retailer-name
variants to one canonical identity anywhere in `lib/`. The closest analog —
`lib/amazonBundle.ts`'s `isAmazonOrder` — is a single-retailer special case
(`retailer.toLowerCase().includes("amazon")`), not a general normalization mechanism:

```ts
export function isAmazonOrder(retailer: string | null): boolean {
  return (retailer ?? "").toLowerCase().includes("amazon");
}
```

**Conclusion:** `Order.retailer` and `Email.retailer` are stored exactly as the AI
extracted them (or as the sender-fallback derived them) — verbatim, un-normalized,
un-deduplicated against any canonical list.

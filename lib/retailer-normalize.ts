// Passive retailer-name normalization for the alpha URL-review flow only.
// Deliberately narrow: lowercase, whitespace, common legal/store suffixes,
// trailing punctuation. No fuzzy matching, no prefix truncation (collision
// risk — e.g. "Buff Beauty" vs "Buff City Soap").
//
// Trailing-punctuation stripping matches the invariant locked in the
// 2026-08-13 cache-sizing investigation (HISTORY.md) for the eventual
// shared retailer cache — "DONNI" and "DONNI." must normalize to the same
// value. Adopting that invariant here means ReturnUrlReview rows use keys
// that will match the future cache without a re-key migration.
const TRAILING_SUFFIXES = [
  "l.l.c.",
  "llc",
  "inc.",
  "inc",
  "ltd",
  "co.",
  "company",
  "online store",
  "store",
];

export function normalizeRetailer(raw: string): string {
  let value = raw.toLowerCase().trim().replace(/\s+/g, " ");

  for (const suffix of TRAILING_SUFFIXES) {
    if (value.endsWith(` ${suffix}`)) {
      value = value.slice(0, -suffix.length - 1).trim();
    } else if (value === suffix) {
      value = "";
    }
  }

  value = value.replace(/[.,;:]+$/, "").trim();

  return value;
}

// A stricter check than normalizeRetailer — used only to decide whether an
// owner-typed correction in the review sheet is meaningful enough to
// overwrite Order.retailer. Deliberately narrower than normalizeRetailer:
// case/whitespace differences ("GAP" vs "Gap Inc.") should NOT count as a
// deliberate correction (that's what normalizeRetailer already treats as
// the same retailer for search-query purposes), but this must NOT use
// normalizeRetailer's suffix-stripping either — "Gap" -> "Gap Inc." is a
// real, intentional retailer-name edit an owner might type, not noise to
// swallow.
export function isMeaningfulRetailerChange(current: string | null, approved: string): boolean {
  const currentNormalized = (current ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  const approvedNormalized = approved.toLowerCase().trim().replace(/\s+/g, " ");
  return currentNormalized !== approvedNormalized;
}

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

// URL-poisoning defense (2026-09-16 fix, see TASKS.md) — used both to keep
// weekly-url-review's Approved-retailer sheet prefill name-only (never a
// domain), and as apply-url-reviews' defense-in-depth before writing
// Order.retailer. Structural, not a TLD allowlist: a real TLD list would
// miss observed poisoned values whose last label isn't a common TLD
// ("mydhl.express.dhl", "dermstore.returns.international"). Instead:
// scheme/www prefixes always match; otherwise the whole string must be
// dot-separated alnum/hyphen labels (no spaces, no "&", no apostrophes —
// already excludes almost every real brand name) AND every label must be
// at least 2 characters, which is what excludes single-letter-initial
// names like "J.Crew" ("j" is a 1-char label) while still matching every
// real poisoned example on file (all of which have 2+ char labels).
// Known limitation: a genuine single-letter domain like "x.com" would not
// be flagged — not observed in practice here, and the tradeoff favors not
// flagging a legitimate short brand name over catching that edge case.
export function isUrlShapedRetailer(value: string | null | undefined): boolean {
  if (!value) return false;
  const s = value.trim().toLowerCase();
  if (!s) return false;
  if (s.includes("://")) return true;
  if (s.startsWith("www.")) return true;

  const bareDomainShape = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  if (!bareDomainShape.test(s)) return false;

  return s.split(".").every((label) => label.length >= 2);
}

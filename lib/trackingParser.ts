import { resolveBodyText } from "./emailBodyText";

export interface TrackingInfo {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

interface CarrierDef {
  name: string;
  // Matches the carrier's known tracking domain in a URL.
  domain: RegExp;
  // Matches the carrier's tracking number format in free text or a URL path.
  numberPattern: RegExp;
  buildUrl: (n: string) => string;
}

// A numberPattern that can never match anything, by construction — used for
// carriers with no publicly documented tracking-number format (see Veho/
// AxleHire below), so fromPlainText() can never mis-claim a number for them
// and fromHtmlHrefs() always leaves trackingNumber null unless the URL
// itself carries a recognisable number (it won't, since this is the pattern
// used to look for one).
const NEVER_MATCHES = /(?!)/;

// Checked in order — UPS first because "1Z…" is the most distinctive pattern
// and has the lowest false-positive risk. USPS next (long digits with 9x
// prefix). FedEx (12/15 digits) and DHL (10/11 digits) next since short
// numeric strings overlap with order numbers and phone numbers. Then the
// 2026-09-04 additions (TASKS.md 🔴 Now, follows the 2026-09-04 tracking
// audit + a live Veho order example): Amazon Logistics/OnTrac/LaserShip/
// UniUni all have distinctive letter-prefixed formats, ordered the same
// way — most distinctive first. Veho and AxleHire are domain-only (see
// NEVER_MATCHES above) so their position doesn't affect false-positive risk;
// placed last since they never participate in plain-text number matching.
const CARRIERS: CarrierDef[] = [
  {
    name: "UPS",
    domain: /\bups\.com\/track/i,
    numberPattern: /\b(1Z[A-Z0-9]{16})\b/i,
    buildUrl: (n) => `https://www.ups.com/track?tracknum=${n}`,
  },
  {
    name: "USPS",
    // Matches any usps.com URL — covers both tools.usps.com/go/TrackConfirmAction
    // and www.usps.com/trackconfirm and similar variants.
    domain: /\busps\.com/i,
    // 20-22 digits starting with 9[2-9] (Priority Mail, First Class Package, etc.)
    numberPattern: /\b(9[2-9]\d{18,20})\b/,
    buildUrl: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  },
  {
    name: "FedEx",
    domain: /\bfedex(?:track)?\.com/i,
    // 12 or 15 digits
    numberPattern: /\b(\d{15}|\d{12})\b/,
    buildUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  },
  {
    name: "DHL",
    domain: /\bdhl\.com/i,
    // 10-11 digits
    numberPattern: /\b(\d{11}|\d{10})\b/,
    buildUrl: (n) => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`,
  },
  {
    name: "Amazon Logistics",
    domain: /\btrack\.amazon\.com/i,
    // TBA/TBM/TBC + 12 digits, 15 chars total (US/North America shipments).
    numberPattern: /\b((?:TBA|TBM|TBC)\d{12})\b/i,
    buildUrl: (n) => `https://track.amazon.com/tracking/${n}`,
  },
  {
    name: "OnTrac",
    domain: /\bontrac\.com/i,
    // 1 letter (C or D) + 14 digits, 15 chars total.
    numberPattern: /\b([CD]\d{14})\b/,
    buildUrl: (n) => `https://www.ontrac.com/tracking/?number=${n}`,
  },
  {
    name: "LaserShip",
    domain: /\blasership\.com/i,
    // "1LS" + alphanumeric suffix, 10-15 chars total.
    numberPattern: /\b(1LS[A-Z0-9]{7,12})\b/i,
    buildUrl: (n) => `https://www.lasership.com/track/${n}`,
  },
  {
    name: "UniUni",
    domain: /\buniuni\.com/i,
    // "UUS" + digits. Range deliberately wide (10-18) — public sources
    // disagree on exact length (13 vs 16-18 digits depending on route), so
    // this looseness is intentional, not sloppy; narrow it if a tighter
    // spec ever surfaces.
    numberPattern: /\b(UUS\d{10,18})\b/i,
    buildUrl: (n) => `https://uniuni.com/tracking/${n}`,
  },
  {
    name: "Veho",
    // No publicly documented tracking-number format — Veho's own API docs
    // explicitly say not to infer anything from a prefix; numbers are long
    // randomized alphanumeric strings with no stable shape. Domain-only
    // detection (see NEVER_MATCHES above): carrier + trackingUrl still
    // surface from a matched href, trackingNumber stays null.
    domain: /\bshipveho\.com/i,
    numberPattern: NEVER_MATCHES,
    buildUrl: (n) => `https://www.shipveho.com/track/${n}`,
  },
  {
    name: "AxleHire",
    // Same rationale as Veho — no stable public tracking-number format.
    // Domain-only detection.
    domain: /\baxlehire\.com/i,
    numberPattern: NEVER_MATCHES,
    buildUrl: (n) => `https://www.axlehire.com/tracking?trackingId=${n}`,
  },
];

// Phase 1: scan href attributes in raw HTML for known carrier tracking domains.
// The most reliable signal — an explicit tracking link in the email body.
// Pulls the tracking number out of the URL when possible; leaves it null if
// the URL itself doesn't contain a recognisable number (the URL alone is still
// enough to show a "Track package" link).
function fromHtmlHrefs(html: string): TrackingInfo | null {
  const hrefRe = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const url = m[1];
    for (const c of CARRIERS) {
      if (c.domain.test(url)) {
        const numMatch = c.numberPattern.exec(url);
        return {
          carrier: c.name,
          trackingNumber: numMatch?.[1] ?? null,
          trackingUrl: url,
        };
      }
    }
  }
  return null;
}

// Phase 2: scan plain text for carrier-specific tracking number patterns.
// More brittle than URL-based detection; used only when no tracking link found.
function fromPlainText(text: string): TrackingInfo | null {
  for (const c of CARRIERS) {
    const m = c.numberPattern.exec(text);
    if (m) {
      return {
        carrier: c.name,
        trackingNumber: m[1],
        trackingUrl: c.buildUrl(m[1]),
      };
    }
  }
  return null;
}

// Returns tracking info extracted from a shipping email's body. Prefers
// URL-based detection from raw HTML (most reliable) over regex on plain text.
// Returns all-null if nothing matches — callers must not block "shipped" status
// on a successful parse.
export function parseTracking(plainText: string | null, rawHtml: string | null): TrackingInfo {
  const empty: TrackingInfo = { carrier: null, trackingNumber: null, trackingUrl: null };

  if (rawHtml) {
    const fromHtml = fromHtmlHrefs(rawHtml);
    if (fromHtml) return fromHtml;
  }

  if (plainText) {
    const fromText = fromPlainText(plainText);
    if (fromText) return fromText;
  }

  return empty;
}

// Text-resolving variant of parseTracking(), for callers that only have the
// raw decrypted textBody/htmlBody fields (2026-09-04, outbound diagnostic —
// docs/audits/2026-09-04-outbound-diagnostic.md). Closes a real gap: a
// tracking number can sit as an <a> tag's VISIBLE link text (not its href),
// invisible to parseTracking()'s plain-text phase whenever textBody is empty
// or too thin, since that phase never receives htmlBody as text — only the
// raw href-domain scan (phase 1, unaffected here) ever looks at rawHtml.
//
// Uses resolveBodyText() (lib/emailBodyText.ts) — NOT
// resolveBodyTextWithAlternate() — deliberately: resolveBodyText() already
// returns textBody completely unchanged, htmlBody never even consulted,
// whenever textBody clears its own substantiality bar. That's the same
// "prefer textBody when substantial" precedence set as a hard constraint in
// the 2026-08-23 H&M fix (efd4f43) — inherited here for free, not
// reimplemented. This is a pure text-resolution step; rawHtml is still
// passed through unchanged for phase 1's href-domain scan.
export function parseTrackingResolved(textBody: string | null, htmlBody: string | null): TrackingInfo {
  return parseTracking(resolveBodyText(textBody, htmlBody), htmlBody);
}

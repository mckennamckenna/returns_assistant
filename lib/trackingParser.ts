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

// Checked in order — UPS first because "1Z…" is the most distinctive pattern
// and has the lowest false-positive risk. USPS next (long digits with 9x
// prefix). FedEx (12/15 digits) and DHL (10/11 digits) last since short
// numeric strings overlap with order numbers and phone numbers.
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

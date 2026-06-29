import { convert } from "html-to-text";

// Below this many non-whitespace characters, textBody is treated as absent
// rather than "present but thin" — iPhone/Apple Mail forwards routinely
// arrive with an empty textBody and all real content in htmlBody.
const MIN_TEXT_BODY_CHARS = 20;

// Keeps the converted HTML body in the same ballpark as a typical real
// textBody rather than sending an entire marketing template's worth of text.
const MAX_HTML_TEXT_CHARS = 12000;

function htmlToPlainText(html: string): string {
  const text = convert(html, {
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      // Preheader text and other display:none elements are invisible to a
      // real reader but still present in the DOM — exclude them so they
      // don't compete with the visible content for the truncation budget.
      { selector: '[style*="display:none" i]', format: "skip" },
      { selector: '[style*="display: none" i]', format: "skip" },
      { selector: '[class*="preheader" i]', format: "skip" },
      { selector: '[id*="preheader" i]', format: "skip" },
    ],
  }).trim();

  return text.slice(0, MAX_HTML_TEXT_CHARS);
}

// textBody wins when it has real content; otherwise fall back to htmlBody
// converted to plain text. Returns null only when neither has anything
// usable. Shared by extraction (lib/runExtraction.ts) and the
// forwarded-header orderDate fallback (lib/linkOrder.ts) so both see
// identical text for the same email — an iPhone forward with an empty
// textBody must not have extraction reading htmlBody while the orderDate
// fallback still only looks at the (empty) textBody.
export function resolveBodyText(textBody: string | null, htmlBody: string | null): string | null {
  const trimmedTextBody = textBody?.trim() ?? "";
  if (trimmedTextBody.replace(/\s/g, "").length > MIN_TEXT_BODY_CHARS) {
    return trimmedTextBody;
  }

  if (htmlBody) {
    return htmlToPlainText(htmlBody);
  }

  return null;
}

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
  return resolveBodyTextWithAlternate(textBody, htmlBody).primary;
}

// Same selection as resolveBodyText, plus the un-chosen source when it has
// real content of its own — for extraction's two-pass retry only (TASKS.md
// 2026-08-22, H&M return_label case): the textBody-preferred default is
// correct in the majority case, but occasionally the body that lost still
// contains a labeled field (e.g. order number) the winner doesn't. `primary`
// is byte-for-byte what resolveBodyText already returns — this is additive,
// not a change to the existing default. `alternate` is null whenever there's
// nothing substantial to retry against (nothing to fall back to, or the
// non-chosen source is itself too thin to be worth a second model call).
export function resolveBodyTextWithAlternate(
  textBody: string | null,
  htmlBody: string | null,
): { primary: string | null; alternate: string | null } {
  const trimmedTextBody = textBody?.trim() ?? "";
  const textSubstantial = trimmedTextBody.replace(/\s/g, "").length > MIN_TEXT_BODY_CHARS;

  if (textSubstantial) {
    if (!htmlBody) return { primary: trimmedTextBody, alternate: null };
    const converted = htmlToPlainText(htmlBody);
    const alternateSubstantial = converted.replace(/\s/g, "").length > MIN_TEXT_BODY_CHARS;
    return { primary: trimmedTextBody, alternate: alternateSubstantial ? converted : null };
  }

  if (htmlBody) {
    // textBody wasn't substantial, so htmlBody is already the primary —
    // nothing meaningful left to offer as a retry alternate.
    return { primary: htmlToPlainText(htmlBody), alternate: null };
  }

  return { primary: null, alternate: null };
}

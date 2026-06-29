import { convert } from "html-to-text";
import { prisma } from "@/lib/db";
import { extractEmail } from "@/lib/extract";
import { linkEmailToOrder } from "@/lib/linkOrder";
import { decrypt } from "@/lib/crypto";

// Below this many non-whitespace characters, textBody is treated as absent
// rather than "present but thin" — iPhone/Apple Mail forwards routinely
// arrive with an empty textBody and all real content in htmlBody.
const MIN_TEXT_BODY_CHARS = 20;

// Keeps the converted HTML body in the same ballpark as a typical real
// textBody rather than sending an entire marketing template's worth of text.
const MAX_HTML_TEXT_CHARS = 12000;

function htmlToExtractionText(html: string): string {
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
// converted to plain text. Returns null only when neither has anything usable.
function resolveExtractionBody(textBody: string | null, htmlBody: string | null): string | null {
  const trimmedTextBody = textBody?.trim() ?? "";
  if (trimmedTextBody.replace(/\s/g, "").length > MIN_TEXT_BODY_CHARS) {
    return trimmedTextBody;
  }

  if (htmlBody) {
    return htmlToExtractionText(htmlBody);
  }

  return null;
}

export async function runExtraction(emailId: string): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return;

  try {
    const decryptedTextBody = email.textBody ? decrypt(email.textBody) : null;
    const decryptedHtmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
    const body = resolveExtractionBody(decryptedTextBody, decryptedHtmlBody);

    if (!body) {
      throw new Error("no textBody or htmlBody to extract from");
    }

    const result = await extractEmail(body);

    await prisma.email.update({
      where: { id: emailId },
      data: {
        emailType: result.emailType,
        retailer: result.retailer,
        orderNumber: result.orderNumber,
        orderDate: result.orderDate ? new Date(result.orderDate) : null,
        deliveryDate: result.deliveryDate ? new Date(result.deliveryDate) : null,
        returnWindowDays: result.returnWindowDays,
        returnWindowStartsFrom: result.returnWindowStartsFrom,
        returnDeadline: result.returnDeadline ? new Date(result.returnDeadline) : null,
        deadlineIsEstimated: result.deadlineIsEstimated,
        policySource: result.policySource,
        orderTotal: result.orderTotal,
        orderCurrency: result.orderCurrency,
        lineItems: result.lineItems as object,
        confidence: result.confidence,
        needsReview: result.needsReview,
        extractionNotes: result.notes,
        extractionRaw: result as object,
        extractedAt: new Date(),
      },
    });

    await linkEmailToOrder(emailId, result.returnPortalUrl);
  } catch (error) {
    console.error("Extraction failed for email", emailId, error);

    await prisma.email.update({
      where: { id: emailId },
      data: { needsReview: true, extractedAt: new Date() },
    });
  }
}

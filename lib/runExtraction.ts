import { prisma } from "@/lib/db";
import { extractEmail } from "@/lib/extract";
import { linkEmailToOrder } from "@/lib/linkOrder";
import { decrypt } from "@/lib/crypto";
import { resolveBodyText } from "@/lib/emailBodyText";

export async function runExtraction(emailId: string): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return;

  try {
    const decryptedTextBody = email.textBody ? decrypt(email.textBody) : null;
    const decryptedHtmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
    const body = resolveBodyText(decryptedTextBody, decryptedHtmlBody);

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

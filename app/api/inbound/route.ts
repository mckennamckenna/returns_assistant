import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractEmail } from "@/lib/extract";

interface PostmarkInboundPayload {
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MailboxHash?: string;
  Date?: string;
}

export async function POST(request: NextRequest) {
  try {
    const payload: PostmarkInboundPayload = await request.json();

    console.log("Inbound email payload:", JSON.stringify(payload));

    const email = await prisma.email.create({
      data: {
        fromEmail: payload.FromFull?.Email ?? "",
        fromName: payload.FromFull?.Name,
        toHash: payload.MailboxHash,
        subject: payload.Subject,
        textBody: payload.TextBody,
        htmlBody: payload.HtmlBody,
        receivedAt: payload.Date ? new Date(payload.Date) : new Date(),
        rawJson: payload as object,
      },
    });

    try {
      if (!email.textBody) {
        throw new Error("no textBody to extract from");
      }

      const result = await extractEmail(email.textBody);

      await prisma.email.update({
        where: { id: email.id },
        data: {
          emailType: result.emailType,
          retailer: result.retailer,
          orderNumber: result.orderNumber,
          orderDate: result.orderDate ? new Date(result.orderDate) : null,
          deliveryDate: result.deliveryDate ? new Date(result.deliveryDate) : null,
          returnWindowDays: result.returnWindowDays,
          returnDeadline: result.returnDeadline ? new Date(result.returnDeadline) : null,
          deadlineIsEstimated: result.deadlineIsEstimated,
          confidence: result.confidence,
          needsReview: result.needsReview,
          extractionNotes: result.notes,
          extractionRaw: result as object,
          extractedAt: new Date(),
        },
      });
    } catch (extractionError) {
      console.error("Extraction failed for email", email.id, extractionError);

      await prisma.email.update({
        where: { id: email.id },
        data: { needsReview: true, extractedAt: new Date() },
      });
    }
  } catch (error) {
    // Always return 200 below so Postmark doesn't retry — log instead.
    console.error("Failed to process inbound email:", error);
  }

  return NextResponse.json({ ok: true });
}

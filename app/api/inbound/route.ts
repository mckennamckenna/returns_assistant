import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";
import { isCommerceEmail } from "@/lib/classify";
import { encryptEmailContent, encryptRawJson } from "@/lib/emailEncryption";

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

    let isCommerce: boolean;
    try {
      isCommerce = await isCommerceEmail(payload.TextBody, payload.HtmlBody);
    } catch (error) {
      // Fail open: a classifier outage shouldn't silently drop real data.
      console.error("Commerce classification failed, keeping email:", error);
      isCommerce = true;
    }

    if (!isCommerce) {
      // Never stored, never logged beyond this count — no content here.
      console.log("Discarded non-commerce email at inbound");
      return NextResponse.json({ ok: true });
    }

    console.log("Inbound email payload:", JSON.stringify(payload));

    const encrypted = encryptEmailContent({
      fromEmail: payload.FromFull?.Email ?? "",
      fromName: payload.FromFull?.Name ?? null,
      textBody: payload.TextBody ?? null,
      htmlBody: payload.HtmlBody ?? null,
    });

    const email = await prisma.email.create({
      data: {
        fromEmail: encrypted.fromEmail,
        fromName: encrypted.fromName,
        toHash: payload.MailboxHash,
        subject: payload.Subject,
        textBody: encrypted.textBody,
        htmlBody: encrypted.htmlBody,
        receivedAt: payload.Date ? new Date(payload.Date) : new Date(),
        rawJson: encryptRawJson(payload),
      },
    });

    // runExtraction catches its own errors and leaves needsReview = true,
    // so it never breaks the 200 response below.
    await runExtraction(email.id);
  } catch (error) {
    // Always return 200 below so Postmark doesn't retry — log instead.
    console.error("Failed to process inbound email:", error);
  }

  return NextResponse.json({ ok: true });
}

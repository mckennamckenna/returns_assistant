import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";

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

    // runExtraction catches its own errors and leaves needsReview = true,
    // so it never breaks the 200 response below.
    await runExtraction(email.id);
  } catch (error) {
    // Always return 200 below so Postmark doesn't retry — log instead.
    console.error("Failed to process inbound email:", error);
  }

  return NextResponse.json({ ok: true });
}

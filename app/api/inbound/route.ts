import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";
import { isCommerceEmail } from "@/lib/classify";
import { encryptEmailContent, encryptRawJson } from "@/lib/emailEncryption";
import { isGmailForwardingVerification, extractVerificationDetails } from "@/lib/gmailVerification";
import { notifyAdmin } from "@/lib/adminNotify";

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

    // Route by the +tag (MailboxHash), which carries the user's opaque
    // inboundToken — never the raw userId, see BUILD.md Milestone 8. Fail
    // fast and cheap here, before spending an AI call on mail we can't
    // attribute to anyone.
    const inboundToken = payload.MailboxHash;
    const user = inboundToken ? await prisma.user.findUnique({ where: { inboundToken } }) : null;

    if (!user) {
      // Same treatment as the non-commerce discard: no content logged,
      // just a count. We have nowhere safe to attribute this mail.
      console.log("Discarded inbound email with unrecognized routing token");
      return NextResponse.json({ ok: true });
    }

    // Gmail's forwarding setup sends this to whichever address the user
    // is trying to forward to — i.e. straight into a user's inbound
    // address, not to anyone's actual inbox. It's not commerce mail and
    // shouldn't be classified or stored as one; it needs a human (the
    // admin) to click the confirmation link or enter the code on Gmail's
    // settings page before forwarding will actually start working.
    if (isGmailForwardingVerification(payload.FromFull?.Email, payload.Subject)) {
      const { code, link } = extractVerificationDetails(payload.TextBody ?? payload.HtmlBody);
      const inboundAddress = `${process.env.POSTMARK_INBOUND_HASH}+${user.inboundToken}@inbound.postmarkapp.com`;

      await notifyAdmin(
        "New user verification needed",
        [
          "A Gmail forwarding verification email arrived for one of your users.",
          "",
          `User account: ${user.email}`,
          `Inbound address used: ${inboundAddress}`,
          "",
          `Confirmation code: ${code ?? "(not found — see raw email below)"}`,
          `Confirmation link: ${link ?? "(not found — see raw email below)"}`,
          "",
          "--- Raw email ---",
          `Subject: ${payload.Subject ?? ""}`,
          "",
          payload.TextBody ?? payload.HtmlBody ?? "(no body)",
        ].join("\n"),
      );

      console.log("Detected Gmail forwarding verification email, notified admin, not stored");
      return NextResponse.json({ ok: true });
    }

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
      // DiscardLog deliberately carries no email content and no userId,
      // matching that same discard philosophy — it exists purely so the
      // admin dashboard can show how often this happens, not what.
      console.log("Discarded non-commerce email at inbound");
      await prisma.discardLog.create({ data: { reason: "non_commerce" } });
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
        userId: user.id,
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

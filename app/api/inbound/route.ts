import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";
import { isCommerceEmail } from "@/lib/classify";
import { encryptEmailContent, encryptRawJson } from "@/lib/emailEncryption";
import { isGmailForwardingVerification, extractVerificationDetails } from "@/lib/gmailVerification";
import { notifyAdmin } from "@/lib/adminNotify";
import { getInboundAddress } from "@/lib/inboundAddress";

interface PostmarkInboundPayload {
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MailboxHash?: string;
  OriginalRecipient?: string;
  To?: string;
  Date?: string;
}

// The "+tag" convention (MailboxHash) only exists on the shared
// inbound.postmarkapp.com domain — Postmark populates it from the part
// between "+" and "@". The pilot custom domain (mail.myreturnwindow.com,
// see lib/inboundAddress.ts) uses a bare `<inboundToken>@domain` address
// with no "+" at all, so MailboxHash is empty for mail that arrives there.
// Falls back to treating the whole local part as the token when the
// recipient's domain matches INBOUND_DOMAIN — never used for the shared
// domain, so this can't accidentally resolve a token for someone it
// shouldn't.
function extractInboundToken(payload: PostmarkInboundPayload): string | null {
  if (payload.MailboxHash) return payload.MailboxHash;

  const pilotDomain = process.env.INBOUND_DOMAIN;
  const recipient = payload.OriginalRecipient || payload.To;
  if (!pilotDomain || !recipient) return null;

  const match = recipient.match(/^([^@]+)@([^@>]+)/);
  if (!match) return null;
  const [, localPart, domain] = match;
  return domain.toLowerCase() === pilotDomain.toLowerCase() ? localPart : null;
}

export async function POST(request: NextRequest) {
  try {
    const payload: PostmarkInboundPayload = await request.json();

    // Route by the inboundToken, resolved from either the "+tag"
    // (MailboxHash) on the shared domain, or the bare local part on the
    // pilot custom domain — see extractInboundToken above. Never the raw
    // userId, see BUILD.md Milestone 8. Fail fast and cheap here, before
    // spending an AI call on mail we can't attribute to anyone.
    const inboundToken = extractInboundToken(payload);
    const user = inboundToken ? await prisma.user.findUnique({ where: { inboundToken } }) : null;

    if (!user) {
      // Same treatment as the non-commerce discard: no content logged,
      // just a count. We have nowhere safe to attribute this mail. The
      // recipient is logged (not personal content, just routing info) —
      // useful while piloting the custom domain, to confirm whether a
      // failure here is "token genuinely unrecognized" vs. "recipient
      // domain didn't match what extractInboundToken expected."
      console.log("Discarded inbound email with unrecognized routing token. Recipient:", payload.OriginalRecipient || payload.To);
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
      const inboundAddress = getInboundAddress(user.inboundToken);

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
        toHash: inboundToken,
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

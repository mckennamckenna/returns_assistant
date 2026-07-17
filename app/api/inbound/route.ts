import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";
import { isCommerceEmail } from "@/lib/classify";
import { encryptEmailContent, encryptRawJson } from "@/lib/emailEncryption";
import { isGmailForwardingVerification, extractVerificationDetails } from "@/lib/gmailVerification";
import { notifyAdmin, hasRecentNotification, recordDedupedNotification } from "@/lib/adminNotify";
import { getInboundAddress } from "@/lib/inboundAddress";
import { recordInboundArrival, INBOUND_FLOOD_THRESHOLD } from "@/lib/inboundVolume";
import { rateLimit } from "@/lib/rateLimit";

const INBOUND_RATE_LIMIT = 30;
const INBOUND_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const INBOUND_RATE_LIMIT_NOTIFY_WINDOW_MS = 60 * 60 * 1000;

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

// Dormant (returns true / lets everything through) when either env var is
// unset — lets this deploy safely before Postmark is configured, zero
// downtime. See TASKS.md rollout checklist before setting these in
// production.
export function isInboundWebhookAuthorized(authorizationHeader: string | null): boolean {
  const expectedUser = process.env.INBOUND_WEBHOOK_USER;
  const expectedPassword = process.env.INBOUND_WEBHOOK_PASSWORD;

  if (!expectedUser || !expectedPassword) return true;

  if (!authorizationHeader || !/^basic /i.test(authorizationHeader)) return false;

  const decoded = Buffer.from(authorizationHeader.slice(6), "base64").toString("utf8");
  const provided = Buffer.from(decoded, "utf8");
  const expected = Buffer.from(`${expectedUser}:${expectedPassword}`, "utf8");

  // timingSafeEqual throws on a length mismatch, so this check routes
  // unequal-length credentials to the same "invalid" outcome first — same
  // guard shape as lib/actionToken.ts's signature comparisons.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function POST(request: NextRequest) {
  // Deliberate single exception to this file's otherwise-universal 200
  // response — an unauthorized request never reaches processing, so
  // there's nothing to "always 200" here. See TASKS.md rollout checklist.
  if (!isInboundWebhookAuthorized(request.headers.get("authorization"))) {
    console.warn("Rejected unauthorized inbound webhook request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    // Abuse control (SECURITY_AUDIT.md H1), keyed on the resolved token —
    // deliberately ahead of the volume counter, the Gmail-verification
    // branch, and any classification/extraction work below, so a blocked
    // request does none of that work. "inbound:" namespaces the key so
    // other future callers of the shared RateLimitCounter table can't
    // collide with this one. This is the second deliberate exception to
    // this file's otherwise-universal 200 response — see the 401 check
    // above for the first; a blocked request never reaches processing, so
    // there's nothing to "always 200" here either.
    const rateLimitResult = await rateLimit({
      key: `inbound:${user.inboundToken}`,
      limit: INBOUND_RATE_LIMIT,
      windowSeconds: INBOUND_RATE_LIMIT_WINDOW_SECONDS,
    });
    if (!rateLimitResult.allowed) {
      const retryAfterSeconds = Math.max(0, Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000));
      console.warn("Inbound message rejected by rate limit:", user.email);

      const subject = `Inbound rate limit hit: ${user.email}`;
      const body = `${user.email}'s forwarding address hit the inbound rate limit (${INBOUND_RATE_LIMIT} messages/hour) and this message was rejected. If unexpected, check their forwarding address for abuse (a leaked/guessed token — see SECURITY_AUDIT.md C1) or a misconfigured filter.`;
      if (await hasRecentNotification("inbound_rate_limited", user.email, INBOUND_RATE_LIMIT_NOTIFY_WINDOW_MS)) {
        await recordDedupedNotification("inbound_rate_limited", subject, body, user.email);
      } else {
        await notifyAdmin(subject, body, "inbound_rate_limited", user.email);
      }

      return NextResponse.json({ error: "Too Many Requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
    }

    // Counted here — before the Gmail-verification branch and before the
    // commerce/discard split below — so every inbound message attributed to
    // a resolved user counts toward flood detection, including the mail
    // that's about to be silently discarded (non-commerce mail never
    // becomes an Email row, so counting only Email rows would miss exactly
    // the case this exists to catch: a broken filter forwarding an entire
    // inbox, almost all of it non-commerce).
    try {
      const count = await recordInboundArrival(user.id);
      if (count >= INBOUND_FLOOD_THRESHOLD) {
        const subject = `Inbound volume spike: ${user.email}`;
        const body = `${user.email} has received ${count}+ inbound messages in the last hour. This usually means a broken Gmail filter is forwarding their entire inbox instead of just shopping emails — check their forwarding setup.`;
        if (await hasRecentNotification("inbound_volume_spike", user.email)) {
          await recordDedupedNotification("inbound_volume_spike", subject, body, user.email);
        } else {
          await notifyAdmin(subject, body, "inbound_volume_spike", user.email);
        }
      }
    } catch (error) {
      // Never let flood detection break inbound processing.
      console.error("Inbound volume tracking failed:", error);
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

      // Surfaced to the user in real time via GET /api/gmail-code (polled
      // from the setup page), in parallel with the admin notify below —
      // not instead of it. Only written when a code was actually found;
      // an unparsed email (code: null) shouldn't clobber a still-valid
      // pending code with null.
      if (code) {
        await prisma.user.update({
          where: { id: user.id },
          data: { gmailVerificationCode: code, gmailVerificationCodeReceivedAt: new Date() },
        });
      }

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
        "gmail_verification",
        user.email,
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

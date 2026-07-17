// Imports AuthError from @auth/core/errors directly, NOT from "next-auth" —
// the "next-auth" package's own entry point transitively imports
// next/server (via next-auth/lib/env.js), which only resolves inside
// Next.js's own bundler, not under plain Node/vitest. next-auth's index.js
// itself does `export { AuthError, ... } from "@auth/core/errors"`, so this
// is the exact same class either way — importing it from here instead of
// "next-auth" is what makes this module (and therefore
// sendVerificationRequest) unit-testable at all, since auth.ts unavoidably
// calls NextAuth(...) at module scope.
import { AuthError } from "@auth/core/errors";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";
import { notifyAdmin, hasRecentNotification, recordDedupedNotification } from "@/lib/adminNotify";
import { rateLimit } from "@/lib/rateLimit";

// Thrown by sendVerificationRequest when either magic-link rate limit is
// hit — a distinct AuthError subclass (Auth.js's own supported extension
// point for signaling a specific sign-in failure) so app/login/actions.ts
// can catch it separately from a generic send failure and show the
// rate-limit-specific message, rather than the generic "couldn't send"
// copy. See TASKS.md's Decisions log for why this is loud, not silent,
// unlike the allowlist gate below.
export class MagicLinkRateLimitError extends AuthError {}

// Pure so SECURITY_AUDIT.md's M1 fix (no bcc, no link ever reaches the
// admin mailbox) is verifiable without mocking sendEmail/Postmark — see
// __tests__/magicLinkRateLimit.test.ts.
export function buildSignInEmailPayload({
  to,
  from,
  url,
}: {
  to: string;
  from: string;
  url: string;
}): { to: string; from: string; subject: string; textBody: string } {
  return {
    to,
    from,
    subject: "Sign in to Return Window",
    textBody: `Click the link below to sign in to Return Window.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email — no account changes were made.`,
  };
}

// Replaces the old bcc: process.env.ADMIN_EMAIL on the sign-in send
// (SECURITY_AUDIT.md M1 — a BCC'd sign-in email put a live, single-use
// magic link into a second mailbox, letting anyone with access to it race
// the real user for login). This carries no url/token — only that a
// sign-in happened, to whom, and when — so a compromised admin mailbox can
// no longer be escalated into impersonating any user who signs in.
export function buildSignInAdminNotification({
  email,
  signedInAt,
}: {
  email: string;
  signedInAt: Date;
}): { subject: string; body: string } {
  return {
    subject: `Sign-in link sent: ${email}`,
    body: `${email} was sent a sign-in link at ${signedInAt.toISOString()}. (This notification deliberately excludes the link itself — see SECURITY_AUDIT.md M1.)`,
  };
}

const MAGIC_LINK_EMAIL_RATE_LIMIT = 8;
const MAGIC_LINK_IP_RATE_LIMIT = 20;
const MAGIC_LINK_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

// Same x-vercel-forwarded-for convention as Phase 1/2's getClientIp
// (app/api/inbound/route.ts, app/api/beta-signup/route.ts) — mirrored
// per-call-site rather than shared, per this codebase's existing
// convention for this exact lookup. `request` here is the standard `Request`
// Auth.js v5 passes into sendVerificationRequest, not NextRequest, but
// `.headers.get(...)` works identically.
function getClientIp(request: Request): string {
  return request.headers.get("x-vercel-forwarded-for") ?? "unknown";
}

// Wired into auth.ts's Nodemailer provider config as sendVerificationRequest.
// Extracted to its own module (rather than living inline in auth.ts) so it's
// unit-testable directly — importing auth.ts itself under vitest fails,
// since NextAuth(...) is called at module scope there and pulls in
// next/server transitively.
//
// Alpha gate: an email only gets a magic link if it already belongs to an
// existing User (re-login, always allowed — never lock out someone who
// already has an account) or is in AllowedSignIn (a manually-curated
// invite). Anything else is silently skipped — no email sent, no error
// thrown — so the verify-request page looks identical either way and
// doesn't leak which emails are approved. Rate limiting below runs before
// that gate and applies uniformly regardless of allowlist status, so it
// doesn't leak allowlist membership either — both allowlisted and
// non-allowlisted emails hit the same limit and see the same message.
export async function sendVerificationRequest({
  identifier,
  url,
  request,
}: {
  identifier: string;
  url: string;
  request: Request;
}): Promise<void> {
  const email = identifier.trim().toLowerCase();
  const [existingUser, allowed] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.allowedSignIn.findUnique({ where: { email } }),
  ]);
  const isAllowlisted = !!(existingUser || allowed);

  const ip = getClientIp(request);
  const [emailLimit, ipLimit] = await Promise.all([
    rateLimit({ key: `magic_link_email:${email}`, limit: MAGIC_LINK_EMAIL_RATE_LIMIT, windowSeconds: MAGIC_LINK_RATE_LIMIT_WINDOW_SECONDS }),
    rateLimit({ key: `magic_link_ip:${ip}`, limit: MAGIC_LINK_IP_RATE_LIMIT, windowSeconds: MAGIC_LINK_RATE_LIMIT_WINDOW_SECONDS }),
  ]);

  if (!emailLimit.allowed || !ipLimit.allowed) {
    // Signal for real users only (see Decisions log) — an unallowlisted
    // email hammering the limit is exactly the noise allowlist_rejection
    // below already reports on; a second alert for the same noise adds
    // nothing.
    if (isAllowlisted) {
      const whichLimit =
        !emailLimit.allowed && !ipLimit.allowed
          ? "both the per-email and per-IP limits"
          : !emailLimit.allowed
            ? "the per-email limit (repeated requests for this address)"
            : "the per-IP limit (many requests from this network)";
      const subject = `Magic-link rate limit hit: ${email}`;
      const body = `${email} hit ${whichLimit} while requesting sign-in links (limits: ${MAGIC_LINK_EMAIL_RATE_LIMIT}/hr per email, ${MAGIC_LINK_IP_RATE_LIMIT}/hr per IP). Could mean a real user being flooded (IP limit) or just retrying (email limit) — worth a look if unexpected.`;

      if (await hasRecentNotification("magic_link_rate_limited", email)) {
        await recordDedupedNotification("magic_link_rate_limited", subject, body, email);
      } else {
        await notifyAdmin(subject, body, "magic_link_rate_limited", email);
      }
    }
    throw new MagicLinkRateLimitError();
  }

  if (!isAllowlisted) {
    // Visibility, not auth — the gate itself is correct; not knowing
    // when it fires is the bug. Deduped per email per 24h so a
    // bot/scanner hammering the same address repeatedly can't spam
    // the owner's inbox; the row is still written either way (with
    // deliveryStatus: "deduped" when suppressed), so a pattern of
    // many deduped rows for one email is visible evidence of
    // scanning even though only the first one actually emailed.
    const subject = "Login attempt from unallowlisted email";
    const body = `${email} tried to sign in but isn't on the allowlist yet.\n\nIf this should be allowed, run:\nnpx tsx scripts/addAllowedSignIn.ts ${email}`;

    if (await hasRecentNotification("allowlist_rejection", email)) {
      await recordDedupedNotification("allowlist_rejection", subject, body, email);
    } else {
      await notifyAdmin(subject, body, "allowlist_rejection", email);
    }
    return;
  }
  await sendEmail(
    buildSignInEmailPayload({
      to: identifier,
      from: (process.env.LOGIN_FROM_EMAIL ?? process.env.REMINDER_FROM_EMAIL)!,
      url,
    }),
  );

  const { subject, body } = buildSignInAdminNotification({ email, signedInAt: new Date() });
  await notifyAdmin(subject, body, "magic_link_sent", email);
}

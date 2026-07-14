import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";

export type NotificationKind =
  | "beta_signup"
  | "allowlist_rejection"
  | "new_user_login"
  | "gmail_verification"
  | "reminder_summary"
  | "weekly_coverage_summary"
  | "weekly_digest_summary"
  | "inbound_volume_spike";

// Centralizes "never let an admin notification failure break the real flow
// it's attached to" — a missing ADMIN_EMAIL or a Postmark hiccup here
// shouldn't fail the inbound webhook or the cron run that called it. Every
// call persists an AdminNotification row regardless of outcome (sent,
// failed, or skipped for missing config), so a swallowed failure still
// leaves a durable trace — Vercel's own function logs are not a substitute,
// they don't retain history long enough to debug after the fact.
export async function notifyAdmin(
  subject: string,
  textBody: string,
  kind: NotificationKind,
  relatedEmail: string | null = null,
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const fromEmail = process.env.REMINDER_FROM_EMAIL;

  if (!adminEmail || !fromEmail) {
    console.error("ADMIN_EMAIL or REMINDER_FROM_EMAIL not configured, skipping admin notification:", subject);
    await prisma.adminNotification.create({
      data: { kind, subject, body: textBody, relatedEmail, deliveryStatus: "skipped_not_configured" },
    });
    return;
  }

  try {
    await sendEmail({ to: adminEmail, from: fromEmail, subject, textBody });
    await prisma.adminNotification.create({
      data: { kind, subject, body: textBody, relatedEmail, deliveryStatus: "sent" },
    });
  } catch (error) {
    console.error("Failed to send admin notification:", subject, error);
    await prisma.adminNotification.create({
      data: {
        kind,
        subject,
        body: textBody,
        relatedEmail,
        deliveryStatus: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// True if any AdminNotification of this kind+relatedEmail (sent, failed,
// skipped, or itself already deduped) fired within the dedup window — used
// by callers whose trigger is a public, unauthenticated surface (e.g.
// auth.ts's allowlist rejection) where a bot hammering the same email
// repeatedly shouldn't spam the owner's inbox. Deliberately not a global
// rate limit (a bot cycling through many distinct emails would sail
// straight through this) — that's a different attack shape that hasn't
// shown up yet; add it if the table ever shows that pattern.
export async function hasRecentNotification(kind: NotificationKind, relatedEmail: string): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await prisma.adminNotification.findFirst({
    where: { kind, relatedEmail, attemptedAt: { gte: since } },
  });
  return existing != null;
}

// Records that a notification was suppressed by the dedup guard, without
// attempting to send anything. The row itself is the audit trail — many
// "deduped" rows for one email is visible evidence of a bot/scanner even
// though no email fired for any of them after the first real one.
export async function recordDedupedNotification(
  kind: NotificationKind,
  subject: string,
  textBody: string,
  relatedEmail: string,
): Promise<void> {
  await prisma.adminNotification.create({
    data: { kind, subject, body: textBody, relatedEmail, deliveryStatus: "deduped" },
  });
}

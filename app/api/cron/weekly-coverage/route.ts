import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";
import { notifyAdmin } from "@/lib/adminNotify";

export const dynamic = "force-dynamic";

const REMINDER_TYPE = "weekly_coverage_check";
const LOOKBACK_DAYS = 7;

function formatCurrency(total: number | null, currency: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

function firstName(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first || "there";
}

interface CoverageItem {
  retailer: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
}

function buildCoverageLines(items: CoverageItem[]): string {
  if (items.length === 0) {
    return "We didn't receive any shopping emails from you this week.";
  }
  return items
    .map((item) => {
      const retailer = item.retailer || "an unknown retailer";
      const total = formatCurrency(item.orderTotal, item.orderCurrency);
      return total ? `- ${retailer} — ${total}` : `- 1 order from ${retailer}`;
    })
    .join("\n");
}

function buildBody(name: string | null, coverageLines: string): string {
  return `Hi ${firstName(name)},

Quick check-in from Return Window — did we track everything you ordered this week?

Here's what we have from you:
${coverageLines}

If that looks right — great, nothing to do!

If we missed something, just reply to this email and let McKenna know what slipped through. It helps us make the app better.

— Return Window`;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Gates this whole feature off by default — an alpha-only check-in
  // shouldn't accidentally start going out to a real user base later
  // just because the cron schedule fired. Must be explicitly enabled.
  if (process.env.ALPHA_MODE !== "true") {
    return NextResponse.json({ skipped: true, reason: "ALPHA_MODE is not enabled" });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const fromEmail = process.env.REMINDER_FROM_EMAIL;
  if (!fromEmail) {
    return NextResponse.json({ error: "REMINDER_FROM_EMAIL not configured" }, { status: 500 });
  }

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany();

  const sent: { userId: string; userEmail: string; orderCount: number }[] = [];
  const skippedAlreadySent: { userId: string; userEmail: string }[] = [];
  const failed: { userId: string; userEmail: string; error: string }[] = [];

  for (const user of users) {
    // "Per user per week," not "per order, ever" — the @@unique on
    // Reminder doesn't help here (orderId is null for every row of this
    // type), so the dedupe check is a recent-send lookup instead.
    if (!force) {
      const recentSend = await prisma.reminder.findFirst({
        where: { userId: user.id, reminderType: REMINDER_TYPE, sentAt: { gte: lookbackStart } },
      });
      if (recentSend) {
        skippedAlreadySent.push({ userId: user.id, userEmail: user.email });
        continue;
      }
    }

    try {
      const recentEmails = await prisma.email.findMany({
        where: { userId: user.id, receivedAt: { gte: lookbackStart } },
        include: { order: { select: { retailer: true, orderTotal: true, orderCurrency: true } } },
      });

      // Dedupe by order — several emails (confirmation, shipping,
      // delivery) about the same order this week should produce one
      // line, not one per email. Unlinked emails fall back to the
      // email's own retailer field, one line each.
      const seenOrderIds = new Set<string>();
      const items: CoverageItem[] = [];
      for (const email of recentEmails) {
        if (email.orderId) {
          if (seenOrderIds.has(email.orderId)) continue;
          seenOrderIds.add(email.orderId);
          items.push({
            retailer: email.order?.retailer ?? null,
            orderTotal: email.order?.orderTotal ?? null,
            orderCurrency: email.order?.orderCurrency ?? null,
          });
        } else {
          items.push({ retailer: email.retailer, orderTotal: null, orderCurrency: null });
        }
      }

      const body = buildBody(user.name, buildCoverageLines(items));
      await sendEmail({
        to: user.email,
        from: fromEmail,
        subject: "Did we catch everything you bought this week? 🛍",
        textBody: body,
      });
      await prisma.reminder.create({ data: { userId: user.id, reminderType: REMINDER_TYPE } });

      sent.push({ userId: user.id, userEmail: user.email, orderCount: items.length });
    } catch (error) {
      console.error("Weekly coverage check failed for user", user.id, error);
      failed.push({
        userId: user.id,
        userEmail: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (sent.length > 0 || failed.length > 0) {
    await notifyAdmin(
      "Return Window: weekly coverage check summary",
      buildAdminSummary(sent, failed),
      "weekly_coverage_summary",
    );
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    force,
    totalUsers: users.length,
    sent,
    skippedAlreadySent,
    failed,
  });
}

function buildAdminSummary(
  sent: { userId: string; userEmail: string; orderCount: number }[],
  failed: { userId: string; userEmail: string; error: string }[],
): string {
  const lines = [`${sent.length} coverage check(s) sent, ${failed.length} failure(s).`, ""];

  if (sent.length > 0) {
    lines.push("Sent:");
    for (const s of sent) {
      lines.push(`- ${s.userEmail} — ${s.orderCount} order(s) this week`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("Failed:");
    for (const f of failed) {
      lines.push(`- ${f.userEmail} — ${f.error}`);
    }
  }

  return lines.join("\n");
}

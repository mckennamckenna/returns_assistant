import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";
import { notifyAdmin } from "@/lib/adminNotify";
import { DISPLAY_STATUS_LABELS } from "@/lib/displayStatus";

export const dynamic = "force-dynamic";

const REMINDER_TYPE = "weekly_digest";
const LOOKBACK_DAYS = 7;
const APP_URL = "https://app.myreturnwindow.com";

// archivedAt / deletedAt don't exist on Order yet — no filter for them.
// Add those filters here once the archive/delete feature lands.
const EXCLUDED_STATUSES = ["returned", "refunded"];

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysFromNow(date: Date, now: Date): number {
  const ms = date.getTime() - now.setHours(0, 0, 0, 0);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function daysLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

interface DigestOrder {
  id: string;
  retailer: string | null;
  orderNumber: string | null;
  returnDeadline: Date;
  displayStatus: string;
}

function buildOrderLine(order: DigestOrder, now: Date): string {
  const retailer = order.retailer || "Unknown retailer";
  const orderRef = order.orderNumber ? ` #${order.orderNumber}` : "";
  const deadline = formatDate(order.returnDeadline);
  const days = daysFromNow(order.returnDeadline, new Date(now));
  const timeLeft = days <= 0 ? "due today" : `due in ${daysLabel(days)}`;
  const status = DISPLAY_STATUS_LABELS[order.displayStatus] ?? order.displayStatus;
  const link = `${APP_URL}/orders/${order.id}`;

  return `${retailer}${orderRef} — ${status} — ${deadline} (${timeLeft})\n${link}`;
}

function buildBody(orders: DigestOrder[], now: Date): string {
  if (orders.length === 0) {
    return `Nothing due this week — you're all caught up.

— Return Window`;
  }

  const lines = orders.map((o) => buildOrderLine(o, now));
  return `Here's what's due in your return windows this week:

${lines.join("\n\n")}

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

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const fromEmail = process.env.REMINDER_FROM_EMAIL;
  if (!fromEmail) {
    return NextResponse.json({ error: "REMINDER_FROM_EMAIL not configured" }, { status: 500 });
  }

  const now = new Date();
  const sevenDaysOut = new Date(now.getTime() + LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany();

  const sent: { userId: string; userEmail: string; orderCount: number }[] = [];
  const skippedAlreadySent: { userId: string; userEmail: string }[] = [];
  const failed: { userId: string; userEmail: string; error: string }[] = [];

  for (const user of users) {
    // Per-user per-week dedup via recent-send lookup (orderId is null for every
    // row of this type, so the @@unique constraint doesn't apply).
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
      const rawOrders = await prisma.order.findMany({
        where: {
          userId: user.id,
          returnDeadline: { gte: now, lte: sevenDaysOut },
          displayStatus: { notIn: EXCLUDED_STATUSES },
        },
        orderBy: { returnDeadline: "asc" },
        select: {
          id: true,
          retailer: true,
          orderNumber: true,
          returnDeadline: true,
          displayStatus: true,
        },
      });
      // The where clause guarantees returnDeadline is non-null here.
      const orders: DigestOrder[] = rawOrders.filter((o) => o.returnDeadline != null) as DigestOrder[];

      const body = buildBody(orders, now);
      await sendEmail({
        to: user.email,
        from: fromEmail,
        subject: "🗓 What's due this week from Return Window",
        textBody: body,
      });
      await prisma.reminder.create({ data: { userId: user.id, reminderType: REMINDER_TYPE } });

      sent.push({ userId: user.id, userEmail: user.email, orderCount: orders.length });
    } catch (error) {
      console.error("Weekly digest failed for user", user.id, error);
      failed.push({
        userId: user.id,
        userEmail: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (sent.length > 0 || failed.length > 0) {
    await notifyAdmin("Return Window: weekly digest summary", buildAdminSummary(sent, failed));
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
  const lines = [`${sent.length} digest(s) sent, ${failed.length} failure(s).`, ""];

  if (sent.length > 0) {
    lines.push("Sent:");
    for (const s of sent) {
      lines.push(`- ${s.userEmail} — ${s.orderCount} order(s) due this week`);
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

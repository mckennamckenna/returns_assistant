import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reminderTypeForOrder, isEligibleForReminder, daysUntil, type OrderForReminder, type ReminderType } from "@/lib/reminders";
import { sendEmail } from "@/lib/postmark";

export const dynamic = "force-dynamic";

const APP_URL = "https://returns-assistant.vercel.app";

const DAYS_LEFT_LABEL: Record<ReminderType, string> = {
  "7_day": "7 days left",
  "2_day": "2 days left",
  "1_day": "1 day left",
  same_day: "Last day",
};

const CLOSES_PHRASE: Record<ReminderType, string> = {
  "7_day": "closes in 7 days",
  "2_day": "closes in 2 days",
  "1_day": "closes in 1 day",
  same_day: "closes today — this is the last day to return",
};

// Closest threshold to however many days are actually left, used only
// under ?force=true so a test send works regardless of whether today
// happens to land exactly on 7/2/1/0 days out.
const THRESHOLDS: [ReminderType, number][] = [
  ["same_day", 0],
  ["1_day", 1],
  ["2_day", 2],
  ["7_day", 7],
];

function nearestReminderType(daysAway: number): ReminderType {
  return THRESHOLDS.reduce((best, candidate) =>
    Math.abs(daysAway - candidate[1]) < Math.abs(daysAway - best[1]) ? candidate : best,
  )[0];
}

function formatCurrency(total: number | null, currency: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function buildSubject(reminderType: ReminderType, retailer: string | null, orderTotal: number | null, orderCurrency: string | null): string {
  const label = DAYS_LEFT_LABEL[reminderType];
  const retailerName = retailer || "your order";
  const total = formatCurrency(orderTotal, orderCurrency);
  return total ? `${label} to return: ${retailerName} · ${total}` : `${label} to return: ${retailerName}`;
}

function buildBody(
  order: { id: string; retailer: string | null; orderNumber: string | null; returnDeadline: Date; deadlineIsEstimated: boolean; orderTotal: number | null; orderCurrency: string | null },
  reminderType: ReminderType,
): string {
  const retailer = order.retailer || "your order";
  const orderRef = order.orderNumber ? ` (order ${order.orderNumber})` : "";
  const deadline = `${formatDate(order.returnDeadline)}${order.deadlineIsEstimated ? " (estimated)" : ""}`;
  const total = formatCurrency(order.orderTotal, order.orderCurrency);

  return [
    `Your return window for ${retailer}${orderRef} ${CLOSES_PHRASE[reminderType]}.`,
    "",
    `Return deadline: ${deadline}`,
    total ? `Order total: ${total}` : null,
    "",
    `View details: ${APP_URL}/orders/${order.id}`,
    "",
    "— Returns Assistant",
  ]
    .filter((line) => line !== null)
    .join("\n");
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

  const today = new Date();
  // Each order's reminder goes to its own owner now, not a single global
  // recipient — see BUILD.md Milestone 8.
  const orders = await prisma.order.findMany({ include: { user: { select: { email: true } } } });

  const sent: { orderId: string; retailer: string | null; reminderType: ReminderType }[] = [];
  const skippedAlreadySent: { orderId: string; reminderType: ReminderType }[] = [];
  const failed: { orderId: string; reminderType: ReminderType; error: string }[] = [];

  for (const order of orders) {
    const asReminderOrder: OrderForReminder = { returnDeadline: order.returnDeadline, status: order.status };

    let reminderType = reminderTypeForOrder(asReminderOrder, today);

    // force bypasses the exact day-threshold match, but still respects the
    // same status/deadline eligibility rules as a normal run.
    if (!reminderType && force && isEligibleForReminder(asReminderOrder)) {
      reminderType = nearestReminderType(daysUntil(asReminderOrder.returnDeadline, today));
    }

    if (!reminderType) continue;

    const existing = await prisma.reminder.findUnique({
      where: { orderId_reminderType: { orderId: order.id, reminderType } },
    });

    if (existing) {
      skippedAlreadySent.push({ orderId: order.id, reminderType });
      continue;
    }

    if (!order.returnDeadline) continue; // type narrowing safety net; reminderType implies this is non-null

    if (!order.user?.email) {
      // Shouldn't happen once every Order has a required userId, but the
      // column is still nullable during the Milestone 8 migration window.
      console.error("Order has no associated user, skipping reminder:", order.id);
      continue;
    }

    // One order's send failing (e.g. a Postmark account/config issue)
    // shouldn't block reminders for every other order in this run.
    try {
      const subject = buildSubject(reminderType, order.retailer, order.orderTotal, order.orderCurrency);
      const body = buildBody(
        {
          id: order.id,
          retailer: order.retailer,
          orderNumber: order.orderNumber,
          returnDeadline: order.returnDeadline,
          deadlineIsEstimated: order.deadlineIsEstimated,
          orderTotal: order.orderTotal,
          orderCurrency: order.orderCurrency,
        },
        reminderType,
      );

      await sendEmail({ to: order.user.email, from: fromEmail, subject, textBody: body });
      await prisma.reminder.create({ data: { orderId: order.id, reminderType } });

      sent.push({ orderId: order.id, retailer: order.retailer, reminderType });
    } catch (error) {
      console.error("Reminder send failed for order", order.id, reminderType, error);
      failed.push({
        orderId: order.id,
        reminderType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ranAt: today.toISOString(),
    force,
    totalOrders: orders.length,
    sent,
    skippedAlreadySent,
    failed,
  });
}

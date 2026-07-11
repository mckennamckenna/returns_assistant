import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  reminderTypeForOrder,
  isEligibleForReminder,
  suppressForEstimatedDeadline,
  daysUntil,
  type OrderForReminder,
  type ReminderType,
} from "@/lib/reminders";
import { sendEmail } from "@/lib/postmark";
import { notifyAdmin } from "@/lib/adminNotify";
import { reminderOrderWhere, hardDeleteCutoff } from "@/lib/orderFilters";
import { runRefundCheckinReminders } from "@/lib/refundCheckin";
import { buildActionLink } from "@/lib/actionLinks";
import { autoArchiveOrderWhere } from "@/lib/autoArchive";

export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

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

export function buildSubject(reminderType: ReminderType, retailer: string | null, orderTotal: number | null, orderCurrency: string | null): string {
  const label = DAYS_LEFT_LABEL[reminderType];
  const retailerName = retailer || "your order";
  const total = formatCurrency(orderTotal, orderCurrency);
  return total ? `${label} to return: ${retailerName} · ${total}` : `${label} to return: ${retailerName}`;
}

export function buildBody(
  order: { id: string; retailer: string | null; orderNumber: string | null; returnDeadline: Date; deadlineIsEstimated: boolean; orderTotal: number | null; orderCurrency: string | null; userId: string },
  reminderType: ReminderType,
): string {
  const retailer = order.retailer || "your order";
  const orderRef = order.orderNumber ? ` (order ${order.orderNumber})` : "";
  const deadline = `${formatDate(order.returnDeadline)}${order.deadlineIsEstimated ? " (estimated)" : ""}`;
  const total = formatCurrency(order.orderTotal, order.orderCurrency);
  const returnedLink = buildActionLink({ orderId: order.id, userId: order.userId, action: "returned" });
  const archiveLink = buildActionLink({ orderId: order.id, userId: order.userId, action: "archive" });

  return [
    `Your return window for ${retailer}${orderRef} ${CLOSES_PHRASE[reminderType]}.`,
    "",
    `Return deadline: ${deadline}`,
    order.deadlineIsEstimated ? "Deadline based on shipping estimate — may shift with delivery." : null,
    total ? `Order total: ${total}` : null,
    "",
    `View details: ${APP_URL}/orders/${order.id}`,
    `Already shipped it back? Mark as returned: ${returnedLink}`,
    `Archive this order (stops all reminders): ${archiveLink}`,
    "",
    "— Return Window",
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

  // Hard-delete orders that were soft-deleted more than HARD_DELETE_DAYS ago.
  // Runs first so deleted orders are already gone before reminder processing.
  const cutoff = hardDeleteCutoff(today);
  const { count: hardDeleted } = await prisma.order.deleteMany({
    where: { deletedAt: { lte: cutoff } },
  });

  // Silently archive orders whose return window closed AUTO_ARCHIVE_GRACE_DAYS
  // ago or more with no user action taken — no email, no Reminder row, no
  // ActionLog row, just archivedAt set (same shape as the manual Archive
  // action). Runs alongside the hard-delete cleanup step, before reminder
  // processing — doesn't interact with it either way, since reminderTypeForOrder
  // only matches exact 7/2/1/0-day thresholds and naturally stops firing on
  // its own well before this grace period elapses.
  const { count: autoArchived } = await prisma.order.updateMany({
    where: autoArchiveOrderWhere(today),
    data: { archivedAt: new Date() },
  });

  // Each order's reminder goes to its own owner now, not a single global
  // recipient — see BUILD.md Milestone 8. Archived/deleted orders are excluded.
  const orders = await prisma.order.findMany({
    where: reminderOrderWhere(),
    include: { user: { select: { email: true } } },
  });

  const sent: {
    orderId: string;
    retailer: string | null;
    orderNumber: string | null;
    reminderType: ReminderType;
    userEmail: string;
  }[] = [];
  const skippedAlreadySent: { orderId: string; reminderType: ReminderType }[] = [];
  const failed: {
    orderId: string;
    retailer: string | null;
    orderNumber: string | null;
    reminderType: ReminderType;
    userEmail: string | null;
    error: string;
  }[] = [];

  for (const order of orders) {
    const asReminderOrder: OrderForReminder = {
      returnDeadline: order.returnDeadline,
      status: order.status,
      displayStatus: order.displayStatus,
      deadlineIsEstimated: order.deadlineIsEstimated,
    };

    let reminderType = reminderTypeForOrder(asReminderOrder, today);

    // force bypasses the exact day-threshold match, but still respects the
    // same status/deadline eligibility rules as a normal run — including
    // estimated-deadline suppression, so a forced test send can't produce
    // a 1-day/same-day email a real run would never send.
    if (!reminderType && force && isEligibleForReminder(asReminderOrder)) {
      const nearest = nearestReminderType(daysUntil(asReminderOrder.returnDeadline, today));
      reminderType = suppressForEstimatedDeadline(nearest, asReminderOrder.deadlineIsEstimated);
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
      // userId is required on Order as of Milestone 8 — this would only
      // happen if the User row itself were deleted out from under an
      // Order, which shouldn't occur given the cascade delete. Surfaced
      // as a failure rather than a silent skip since it's unexpected.
      console.error("Order has no associated user, skipping reminder:", order.id);
      failed.push({
        orderId: order.id,
        retailer: order.retailer,
        orderNumber: order.orderNumber,
        reminderType,
        userEmail: null,
        error: "Order has no associated user",
      });
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
          userId: order.userId,
        },
        reminderType,
      );

      await sendEmail({ to: order.user.email, from: fromEmail, subject, textBody: body });
      await prisma.reminder.create({ data: { orderId: order.id, userId: order.userId, reminderType } });

      sent.push({
        orderId: order.id,
        retailer: order.retailer,
        orderNumber: order.orderNumber,
        reminderType,
        userEmail: order.user.email,
      });
    } catch (error) {
      console.error("Reminder send failed for order", order.id, reminderType, error);
      failed.push({
        orderId: order.id,
        retailer: order.retailer,
        orderNumber: order.orderNumber,
        reminderType,
        userEmail: order.user.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Only notify when something actually happened — a daily "0 reminders,
  // 0 failures" email would just be noise. Failures still warrant a
  // summary even with zero successful sends.
  if (sent.length > 0 || failed.length > 0) {
    await notifyAdmin("Return Window: reminder run summary", buildAdminSummary(sent, failed), "reminder_summary");
  }

  // Refund check-in reminders: fires 5 days after returned (with return tracking)
  // or 10 days (without). Separate from the deadline reminder loop above.
  const refundCheckin = await runRefundCheckinReminders(today, fromEmail);

  return NextResponse.json({
    ranAt: today.toISOString(),
    force,
    hardDeleted,
    autoArchived,
    totalOrders: orders.length,
    sent,
    skippedAlreadySent,
    failed,
    refundCheckin,
  });
}

function buildAdminSummary(
  sent: { orderId: string; retailer: string | null; orderNumber: string | null; reminderType: ReminderType; userEmail: string }[],
  failed: {
    orderId: string;
    retailer: string | null;
    orderNumber: string | null;
    reminderType: ReminderType;
    userEmail: string | null;
    error: string;
  }[],
): string {
  const lines = [`${sent.length} reminder(s) sent, ${failed.length} failure(s).`, ""];

  if (sent.length > 0) {
    lines.push("Sent:");
    for (const s of sent) {
      const orderRef = s.orderNumber ? ` (${s.orderNumber})` : "";
      lines.push(`- ${s.retailer ?? "Unknown retailer"}${orderRef} — ${s.reminderType} — to ${s.userEmail} — order ${APP_URL}/orders/${s.orderId}`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("Failed:");
    for (const f of failed) {
      const orderRef = f.orderNumber ? ` (${f.orderNumber})` : "";
      lines.push(`- ${f.retailer ?? "Unknown retailer"}${orderRef} — ${f.reminderType} — user ${f.userEmail ?? "unknown"} — order ${f.orderId} — ${f.error}`);
    }
  }

  return lines.join("\n");
}

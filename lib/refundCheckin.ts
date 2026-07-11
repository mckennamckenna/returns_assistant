import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";
import { activeOrderFilter } from "@/lib/orderFilters";
import { escapeHtml, htmlLink, wrapEmailHtml } from "@/lib/emailHtml";

export const REFUND_CHECKIN_REMINDER_TYPE = "refund_checkin";

// Delay from returnedAt before the check-in email fires.
// Shorter when the retailer's return carrier has tracking — we can
// reasonably expect their warehouse scan within ~5 days. Without
// tracking we allow 10 days to account for slower untracked returns.
const DELAY_WITH_TRACKING_DAYS = 5;
const DELAY_WITHOUT_TRACKING_DAYS = 10;

const APP_URL = "https://app.myreturnwindow.com";

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function refundCheckinSendAfter(returnedAt: Date, hasTracking: boolean): Date {
  const days = hasTracking ? DELAY_WITH_TRACKING_DAYS : DELAY_WITHOUT_TRACKING_DAYS;
  return new Date(returnedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

// The Prisma where clause for orders that need a refund check-in reminder.
// Spread into findMany — exported so tests can assert on it directly.
export function refundCheckinOrderWhere() {
  return {
    displayStatus: "returned" as const,
    returnedAt: { not: null as null },
    ...activeOrderFilter,
    // Skip orders that already got this reminder — the @@unique constraint
    // on (orderId, reminderType) enforces exactly-once at the DB level too,
    // but filtering here avoids fetching those rows at all.
    reminders: { none: { reminderType: REFUND_CHECKIN_REMINDER_TYPE } },
  };
}

export function buildRefundCheckinBody(order: {
  retailer: string | null;
  lineItems: unknown;
  returnedAt: Date;
  id: string;
}): string {
  const retailer = order.retailer ?? "Your order";
  const items = Array.isArray(order.lineItems)
    ? (order.lineItems as Array<{ name?: string }>)
    : [];
  const itemName = items[0]?.name ?? null;
  const returnedDate = order.returnedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const ref = itemName ? `${retailer} / ${itemName}` : retailer;

  return `${ref} was marked returned on ${returnedDate} — your refund should have landed by now. Worth a quick check of your card statement.

View order: ${APP_URL}/orders/${order.id}

— Return Window`;
}

// HTML counterpart of buildRefundCheckinBody — same content, a real <a> link
// instead of a raw URL. Sent alongside the plain text, never in place of it.
export function buildRefundCheckinHtmlBody(order: {
  retailer: string | null;
  lineItems: unknown;
  returnedAt: Date;
  id: string;
}): string {
  const retailer = order.retailer ?? "Your order";
  const items = Array.isArray(order.lineItems)
    ? (order.lineItems as Array<{ name?: string }>)
    : [];
  const itemName = items[0]?.name ?? null;
  const returnedDate = order.returnedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const ref = itemName ? `${retailer} / ${itemName}` : retailer;
  const link = `${APP_URL}/orders/${order.id}`;

  return wrapEmailHtml(`
    <p style="margin:0 0 16px;">${escapeHtml(ref)} was marked returned on ${escapeHtml(returnedDate)} — your refund should have landed by now. Worth a quick check of your card statement.</p>
    <p style="margin:0;">${htmlLink(link, "View order details")}</p>
  `);
}

// ── DB / email (called from the daily cron) ───────────────────────────────────

export async function runRefundCheckinReminders(
  now: Date,
  fromEmail: string,
): Promise<{
  sent: { orderId: string; retailer: string | null; userEmail: string }[];
  skipped: { orderId: string; reason: string }[];
  failed: { orderId: string; error: string }[];
}> {
  const sent: { orderId: string; retailer: string | null; userEmail: string }[] = [];
  const skipped: { orderId: string; reason: string }[] = [];
  const failed: { orderId: string; error: string }[] = [];

  const orders = await prisma.order.findMany({
    where: refundCheckinOrderWhere(),
    include: { user: { select: { email: true } } },
  });

  for (const order of orders) {
    if (!order.returnedAt) continue; // type narrowing; query guarantees non-null

    const sendAfter = refundCheckinSendAfter(order.returnedAt, !!order.returnTrackingNumber);
    if (now < sendAfter) {
      skipped.push({ orderId: order.id, reason: `not due until ${sendAfter.toISOString()}` });
      continue;
    }

    if (!order.user?.email) {
      skipped.push({ orderId: order.id, reason: "no user email" });
      continue;
    }

    try {
      const orderForBody = {
        retailer: order.retailer,
        lineItems: order.lineItems,
        returnedAt: order.returnedAt,
        id: order.id,
      };
      const body = buildRefundCheckinBody(orderForBody);
      const htmlBody = buildRefundCheckinHtmlBody(orderForBody);

      await sendEmail({
        to: order.user.email,
        from: fromEmail,
        subject: "Worth checking your refund",
        textBody: body,
        htmlBody,
      });

      await prisma.reminder.create({
        data: { orderId: order.id, userId: order.userId, reminderType: REFUND_CHECKIN_REMINDER_TYPE },
      });

      sent.push({ orderId: order.id, retailer: order.retailer, userEmail: order.user.email });
    } catch (error) {
      console.error("Refund check-in reminder failed for order", order.id, error);
      failed.push({
        orderId: order.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sent, skipped, failed };
}

import { prisma } from "@/lib/db";
import { daysUntil } from "@/lib/reminders";
import { activeOrderFilter } from "@/lib/orderFilters";
import type { OrderCardOrder } from "@/app/OrderCard";

// Statuses where starting a return is still a meaningful, available action.
// Once a return has been started, refunded, completed, or the window has
// passed, the order is no longer "open" in this sense.
export const OPEN_STATUSES = ["ordered", "shipped", "delivered", "returnable", "needs_review"];
export const CLOSING_SOON_DAYS = 7;

export function isClosingSoon(order: { returnDeadline: Date | null }, now: Date): boolean {
  if (order.returnDeadline == null) return false;
  const days = daysUntil(order.returnDeadline, now);
  return days >= 0 && days <= CLOSING_SOON_DAYS;
}

// Single source of truth for what counts as an "alert" — both the
// BottomNav/Sidebar badge count (app/(app)/layout.tsx) and the actual list
// on /alerts read from here, so they can't drift apart the way the badge
// count and app/page.tsx's own copy of this logic used to before Commit 2's
// follow-up fixes.
export async function getAlertOrders(userId: string, now: Date = new Date()): Promise<OrderCardOrder[]> {
  const openOrders = await prisma.order.findMany({
    where: { userId, ...activeOrderFilter, status: { in: OPEN_STATUSES } },
    // Exactly what OrderCard (the only renderer of this list) reads — this
    // previously fetched full Order rows on every page navigation
    // (app/(app)/layout.tsx calls this for the alert-count badge on every
    // authenticated page). Order rows are small, but the call frequency
    // compounds; see TASKS.md's missing-select-email-order-queries entry.
    select: {
      id: true,
      retailer: true,
      orderNumber: true,
      displayStatus: true,
      returnDeadline: true,
      orderTotal: true,
      orderCurrency: true,
      returnPortalUrl: true,
      archivedAt: true,
      trackingNumber: true,
      trackingUrl: true,
      returnTrackingNumber: true,
      returnTrackingUrl: true,
      lineItems: true,
      policySource: true,
      needsReview: true,
    },
  });
  return openOrders.filter((o) => o.needsReview || isClosingSoon(o, now));
}

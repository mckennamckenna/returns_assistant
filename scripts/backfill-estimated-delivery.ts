// One-time backfill after splitting Order/Email's ambiguous `deliveryDate`
// into `estimatedDeliveryDate` (carrier ETA, never confirmed) and
// `deliveredAt` (only set from an actual "delivery" email) — see
// lib/extract.ts's computeDeadline fix for the Proenza Schouler bug this
// exists to correct.
//
// Only touches Orders where deliveredAt is still null (no confirmed
// delivery has ever happened) and the legacy deliveryDate is set (there's
// something to react to):
//
//   - deliveryDate in the FUTURE (a live, still-plausible estimate, e.g.
//     the Proenza Schouler order itself): backfill
//     estimatedDeliveryDate = deliveryDate, then recompute
//     returnDeadline/deadlineIsEstimated via computeDeadline so it flows
//     through the normal (now-fixed) code path.
//   - deliveryDate in the PAST (the estimate already elapsed with no
//     confirmed delivery ever recorded — a failed estimate, not a live
//     one): flag deadlineIsEstimated: true ONLY. Deliberately does NOT
//     populate estimatedDeliveryDate or recompute returnDeadline — a
//     stale estimate might have been wrong, and presenting a already-passed
//     date as "the current estimate" would be worse than leaving it alone.
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/backfill-estimated-delivery.ts

import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: { deliveredAt: null, deliveryDate: { not: null } },
  });

  let futureCount = 0;
  let pastCount = 0;

  for (const order of orders) {
    const deliveryDate = order.deliveryDate!;

    if (deliveryDate >= now) {
      const { returnDeadline, deadlineIsEstimated } = computeDeadline({
        orderDate: order.orderDate ? order.orderDate.toISOString() : null,
        deliveredAt: null,
        estimatedDeliveryDate: deliveryDate.toISOString(),
        returnWindowDays: order.returnWindowDays,
        returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
      });

      console.log(
        `[future] ${order.retailer} #${order.orderNumber} (${order.id}): estimatedDeliveryDate -> ${deliveryDate.toISOString()}, deadlineIsEstimated ${order.deadlineIsEstimated} -> ${deadlineIsEstimated}`,
      );

      await prisma.order.update({
        where: { id: order.id },
        data: {
          estimatedDeliveryDate: deliveryDate,
          returnDeadline: returnDeadline ? new Date(returnDeadline) : order.returnDeadline,
          deadlineIsEstimated,
        },
      });
      futureCount++;
    } else {
      if (order.deadlineIsEstimated) continue; // already flagged, nothing to do

      console.log(
        `[past, stale] ${order.retailer} #${order.orderNumber} (${order.id}): deadlineIsEstimated false -> true (returnDeadline left untouched)`,
      );

      await prisma.order.update({
        where: { id: order.id },
        data: { deadlineIsEstimated: true },
      });
      pastCount++;
    }
  }

  console.log(
    `Checked ${orders.length} orders. ${futureCount} live estimates backfilled, ${pastCount} stale estimates flagged.`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

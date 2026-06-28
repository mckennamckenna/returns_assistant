// One-time recompute after fixing a bug in computeDeadline() (lib/extract.ts):
// when returnWindowStartsFrom was "order_date" and there was no
// deliveryDate, the function was still adding the 7-day standard-shipping
// buffer before applying returnWindowDays — wrong, since that buffer
// exists to estimate a missing delivery date, which is irrelevant once
// the policy is known to count from order date directly. Recomputes every
// order's returnDeadline/deadlineIsEstimated from its existing
// orderDate/deliveryDate/returnWindowDays/returnWindowStartsFrom — never
// re-derives those input fields themselves (see Milestone 15's note on
// why that's the risk to avoid: re-deriving dates can reintroduce
// timezone drift from whatever environment happens to run the script).
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/recompute-deadlines.ts

import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany();
  let changed = 0;

  for (const order of orders) {
    const { returnDeadline, deadlineIsEstimated } = computeDeadline({
      orderDate: order.orderDate ? order.orderDate.toISOString() : null,
      deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
      returnWindowDays: order.returnWindowDays,
      returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
    });

    const newDeadline = returnDeadline ? new Date(returnDeadline) : null;
    const deadlineChanged = (newDeadline?.getTime() ?? null) !== (order.returnDeadline?.getTime() ?? null);
    const estimatedChanged = deadlineIsEstimated !== order.deadlineIsEstimated;

    if (deadlineChanged || estimatedChanged) {
      console.log(
        `${order.retailer} #${order.orderNumber} (${order.id}): ${order.returnDeadline?.toISOString() ?? "null"} (estimated=${order.deadlineIsEstimated}) -> ${newDeadline?.toISOString() ?? "null"} (estimated=${deadlineIsEstimated})`,
      );
      await prisma.order.update({
        where: { id: order.id },
        data: { returnDeadline: newDeadline, deadlineIsEstimated },
      });
      changed++;
    }
  }

  console.log(`Recomputed ${orders.length} orders, ${changed} changed.`);
}

main()
  .catch((error) => {
    console.error("Recompute failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

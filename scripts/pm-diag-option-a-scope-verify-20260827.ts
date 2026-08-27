/**
 * scripts/pm-diag-option-a-scope-verify-20260827.ts
 *
 * READ-ONLY. 0 billed Anthropic calls. 0 DB writes.
 *
 * Re-verifies the Option A backfill scope right before building it
 * (DELIVERED_BADGE_DESIGN_20260827.md §5/§6, TASKS.md build session
 * 2026-08-27). Criteria: an Order whose linked `delivery`-type email is
 * `forwardType='auto'`, has no body-extracted deliveryDate, has a non-null
 * anchorDate, and whose Order.deliveredAt is still null and displayStatus
 * is 'delivered'.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.email.findMany({
    where: {
      emailType: "delivery",
      forwardType: "auto",
      deliveryDate: null,
      anchorDate: { not: null },
    },
    select: {
      id: true,
      orderId: true,
      retailer: true,
      anchorDate: true,
      anchorSource: true,
    },
  });

  console.log(`Candidate delivery emails (auto-forward, no body date, anchorDate set): ${candidates.length}`);

  const results = [];
  for (const c of candidates) {
    if (!c.orderId) continue;
    const order = await prisma.order.findUnique({
      where: { id: c.orderId },
      select: { id: true, retailer: true, orderNumber: true, displayStatus: true, deliveredAt: true, estimatedDeliveryDate: true },
    });
    if (!order) continue;
    const matches = order.deliveredAt === null && order.displayStatus === "delivered";
    results.push({ order, email: c, matches });
  }

  const inScope = results.filter((r) => r.matches);
  console.log(`\nOrders matching full backfill criteria (deliveredAt null AND displayStatus='delivered'): ${inScope.length}`);
  for (const r of inScope) {
    console.log({
      orderId: r.order.id,
      retailer: r.order.retailer,
      orderNumber: r.order.orderNumber,
      anchorDate: r.email.anchorDate,
      currentBadge: `estimatedDeliveryDate=${r.order.estimatedDeliveryDate?.toISOString()} -> "Arrives" chip (deliveredAt null)`,
    });
  }

  console.log(`\nCandidates NOT in scope (delivery email matches but order doesn't need backfill) — expect the 2 'kept' latent orders here:`);
  for (const r of results.filter((r) => !r.matches)) {
    console.log({ orderId: r.order.id, retailer: r.order.retailer, orderNumber: r.order.orderNumber, displayStatus: r.order.displayStatus, deliveredAt: r.order.deliveredAt });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

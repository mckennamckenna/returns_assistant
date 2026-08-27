/**
 * scripts/pm-diag-orderdate-mismatch-v2-20260827.ts
 *
 * READ-ONLY. 0 billed Anthropic calls. 0 DB writes.
 *
 * Corrected systemic check: v1 (pm-diag-orderdate-mismatch-20260827.ts)
 * only checked orderDate against each linked email's receivedAt/anchorDate,
 * missing the legitimate case where orderDate came directly from an
 * email's own AI-extracted orderDate field (a real stated date, which
 * routinely predates receivedAt/anchorDate by days and is NOT a bug).
 * This version cross-references against each email's extracted orderDate
 * too, and separates two independent signals:
 *   (A) "impossible" — orderDate falls AFTER the earliest linked
 *       shipping_confirmation/delivery email's receivedAt. Order-placed-
 *       after-it-shipped is never legitimate, regardless of source.
 *   (B) "unexplained" — orderDate doesn't match ANY linked email's
 *       receivedAt, anchorDate, OR own extracted orderDate. Weaker signal
 *       (could reflect a since-changed/re-extracted email, or an order
 *       whose establishing email was later replaced), but still worth
 *       counting separately from (A).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const allOrders = await prisma.order.findMany({
    where: { orderDate: { not: null } },
    select: { id: true, retailer: true, orderNumber: true, orderDate: true, orderDateEstimated: true },
  });
  console.log(`Total orders with non-null orderDate: ${allOrders.length}`);

  let impossibleCount = 0;
  let unexplainedCount = 0;
  const impossibleOffenders: any[] = [];
  const unexplainedOffenders: any[] = [];

  for (const o of allOrders) {
    const orderEmails = await prisma.email.findMany({
      where: { orderId: o.id },
      orderBy: { receivedAt: "asc" },
      select: {
        id: true,
        emailType: true,
        receivedAt: true,
        forwardType: true,
        anchorDate: true,
        orderDate: true,
      },
    });
    if (orderEmails.length === 0) continue;

    const orderDateMs = o.orderDate!.getTime();

    const derivable = new Set<number>();
    for (const e of orderEmails) {
      if (e.receivedAt) derivable.add(e.receivedAt.getTime());
      if (e.anchorDate) derivable.add(e.anchorDate.getTime());
      if (e.orderDate) derivable.add(e.orderDate.getTime());
    }
    const isExplained = derivable.has(orderDateMs);

    const earliestShipOrDeliver = orderEmails
      .filter((e) => e.emailType === "shipping_confirmation" || e.emailType === "delivery")
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())[0];
    const isImpossible = earliestShipOrDeliver ? orderDateMs > earliestShipOrDeliver.receivedAt.getTime() : false;

    if (isImpossible) {
      impossibleCount++;
      if (impossibleOffenders.length < 20) {
        impossibleOffenders.push({
          id: o.id,
          retailer: o.retailer,
          orderNumber: o.orderNumber,
          orderDate: o.orderDate,
          orderDateEstimated: o.orderDateEstimated,
          earliestShipOrDeliverReceivedAt: earliestShipOrDeliver!.receivedAt,
          emailCount: orderEmails.length,
        });
      }
    } else if (!isExplained) {
      unexplainedCount++;
      if (unexplainedOffenders.length < 15) {
        unexplainedOffenders.push({
          id: o.id,
          retailer: o.retailer,
          orderNumber: o.orderNumber,
          orderDate: o.orderDate,
          orderDateEstimated: o.orderDateEstimated,
          emailCount: orderEmails.length,
        });
      }
    }
  }

  console.log(`\n(A) IMPOSSIBLE — orderDate is AFTER the earliest shipping/delivery email's receivedAt: ${impossibleCount} / ${allOrders.length}`);
  console.log("Sample offenders:");
  for (const o of impossibleOffenders) console.log(o);

  console.log(`\n(B) UNEXPLAINED (but not provably impossible) — orderDate matches no linked email's receivedAt/anchorDate/own-extracted-orderDate: ${unexplainedCount} / ${allOrders.length}`);
  console.log("Sample offenders:");
  for (const o of unexplainedOffenders) console.log(o);

  const zaraInA = impossibleOffenders.some((o) => o.orderNumber === "54421192781");
  const zaraInB = unexplainedOffenders.some((o) => o.orderNumber === "54421192781");
  console.log(`\nZara #54421192781 in (A) impossible: ${zaraInA}. In (B) unexplained sample (may be truncated at 15): checking directly...`);
  const zaraCheck = allOrders.find((o) => o.orderNumber === "54421192781");
  console.log("Zara present in allOrders queried:", !!zaraCheck);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

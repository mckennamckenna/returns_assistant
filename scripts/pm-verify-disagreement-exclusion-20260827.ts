import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function disagrees(dates: Date[]): boolean {
  for (let i = 0; i < dates.length; i++) {
    for (let j = i + 1; j < dates.length; j++) {
      if (!sameDay(dates[i], dates[j])) return true;
    }
  }
  return false;
}

async function main() {
  const allOrders = await prisma.order.findMany({ select: { id: true, retailer: true, orderNumber: true, orderDate: true } });

  const bucketA: any[] = [];
  const droppedToC: any[] = [];

  for (const o of allOrders) {
    const confirmations = await prisma.email.findMany({
      where: { orderId: o.id, emailType: "order_confirmation" },
      select: { orderDate: true, anchorDate: true },
    });

    const orderDateCandidates = confirmations.map((c) => c.orderDate).filter((d): d is Date => d != null);
    const anchorDateCandidates = confirmations.map((c) => c.anchorDate).filter((d): d is Date => d != null);

    let rule: string | null = null;
    let candidateDate: Date | null = null;
    let excluded = false;

    if (orderDateCandidates.length > 0) {
      rule = "priority 1";
      candidateDate = orderDateCandidates[0];
      if (orderDateCandidates.length > 1 && disagrees(orderDateCandidates)) excluded = true;
    } else if (anchorDateCandidates.length > 0) {
      rule = "priority 2";
      candidateDate = anchorDateCandidates[0];
      if (anchorDateCandidates.length > 1 && disagrees(anchorDateCandidates)) excluded = true;
    }

    if (!candidateDate) continue; // bucket c/none, not bucket a territory

    if (excluded) {
      droppedToC.push({ retailer: o.retailer, orderNumber: o.orderNumber, rule, candidates: rule === "priority 1" ? orderDateCandidates : anchorDateCandidates });
      continue;
    }

    if (o.orderDate?.getTime() !== candidateDate.getTime()) {
      bucketA.push({ retailer: o.retailer, orderNumber: o.orderNumber, currentOrderDate: o.orderDate, newOrderDate: candidateDate, rule });
    }
  }

  console.log(`Bucket (a) after disagreement exclusion: ${bucketA.length}`);
  for (const b of bucketA) console.log(b);

  console.log(`\nExcluded due to disagreement (dropped to bucket c): ${droppedToC.length}`);
  for (const d of droppedToC) console.log(d);
}

main().finally(() => prisma.$disconnect());

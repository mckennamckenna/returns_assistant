import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const totalOrders = await prisma.order.count();
  const nullOrderDate = await prisma.order.count({ where: { orderDate: null } });
  const nonNullOrderDate = await prisma.order.count({ where: { orderDate: { not: null } } });
  console.log(`Total orders: ${totalOrders}`);
  console.log(`orderDate IS NULL: ${nullOrderDate}`);
  console.log(`orderDate IS NOT NULL: ${nonNullOrderDate} (this matches the original 185-order diagnosis population)`);

  const allOrders = await prisma.order.findMany({
    select: { id: true, retailer: true, orderNumber: true, orderDate: true },
  });

  let bucketA = 0; // value changes
  let bucketB = 0; // extracted, value stays same
  let bucketC = 0; // fallback label only
  let nullToNull = 0; // was null, stays null (residual, no candidate)
  const bucketADetails: any[] = [];

  for (const o of allOrders) {
    const confirmations = await prisma.email.findMany({
      where: { orderId: o.id, emailType: "order_confirmation" },
      select: { orderDate: true, anchorDate: true },
    });
    const p1 = confirmations.find((e) => e.orderDate != null);
    const p2 = !p1 ? confirmations.find((e) => e.anchorDate != null) : null;
    const candidateDate = p1?.orderDate ?? p2?.anchorDate ?? null;
    const rule = p1 ? "priority 1" : p2 ? "priority 2" : "none";

    if (candidateDate == null) {
      if (o.orderDate == null) nullToNull++;
      else bucketC++;
      continue;
    }

    const currentMs = o.orderDate?.getTime();
    const newMs = candidateDate.getTime();
    if (currentMs === newMs) {
      bucketB++;
    } else {
      bucketA++;
      bucketADetails.push({
        retailer: o.retailer,
        orderNumber: o.orderNumber,
        currentOrderDate: o.orderDate,
        newOrderDate: candidateDate,
        rule,
      });
    }
  }

  console.log(`\nBucket (a) — orderDate VALUE changes (real correction): ${bucketA}`);
  console.log(`Bucket (b) — orderDate unchanged, source set to 'extracted' (already correct): ${bucketB}`);
  console.log(`Bucket (c) — orderDate unchanged (or stays null), source set to 'fallback': ${bucketC}`);
  console.log(`(orderDate was null AND no candidate found — stays null, source 'fallback'): ${nullToNull}`);
  console.log(`Check: a+b+c+nullToNull = ${bucketA + bucketB + bucketC + nullToNull} (should equal ${totalOrders})`);

  console.log(`\n=== Bucket (a) full list — the real corrections ===`);
  for (const d of bucketADetails) console.log(d);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

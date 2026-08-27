import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const STEP1_SQL = `
WITH candidate_emails AS (
  SELECT
    "orderId",
    MIN("anchorDate") AS "earliestAnchorDate"
  FROM "Email"
  WHERE "emailType" = 'delivery'
    AND "forwardType" = 'auto'
    AND "deliveryDate" IS NULL
    AND "anchorDate" IS NOT NULL
    AND "orderId" IS NOT NULL
  GROUP BY "orderId"
)
SELECT
  o.id,
  o."userId",
  o.retailer,
  o."orderNumber",
  o."displayStatus",
  o."deliveredAt" AS "current_deliveredAt",
  ce."earliestAnchorDate" AS "will_backfill_to",
  o."estimatedDeliveryDate"
FROM "Order" o
JOIN candidate_emails ce ON ce."orderId" = o.id
WHERE o."deliveredAt" IS NULL
  AND o."displayStatus" = 'delivered'
ORDER BY o."updatedAt" DESC;
`;

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(STEP1_SQL);
  console.log(`Row count: ${rows.length}\n`);
  for (const r of rows) console.log(r);

  // Supplementary sanity check (not part of the SQL file): pull orderDate
  // for each in-scope order to sanity-check will_backfill_to isn't before
  // orderDate or in the future.
  console.log("\n--- sanity check: will_backfill_to vs orderDate / now ---");
  const now = new Date();
  for (const r of rows) {
    const order = await prisma.order.findUnique({ where: { id: r.id }, select: { orderDate: true } });
    const backfill = new Date(r.will_backfill_to);
    const beforeOrderDate = order?.orderDate ? backfill.getTime() < order.orderDate.getTime() : false;
    const inFuture = backfill.getTime() > now.getTime();
    console.log({
      id: r.id,
      retailer: r.retailer,
      orderNumber: r.orderNumber,
      orderDate: order?.orderDate,
      will_backfill_to: r.will_backfill_to,
      beforeOrderDate,
      inFuture,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

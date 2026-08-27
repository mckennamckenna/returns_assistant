import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const STEP2_SQL = `
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
UPDATE "Order" o
SET "deliveredAt" = ce."earliestAnchorDate"
FROM candidate_emails ce
WHERE ce."orderId" = o.id
  AND o."deliveredAt" IS NULL
  AND o."displayStatus" = 'delivered';
`;

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
  const result = await prisma.$executeRawUnsafe(STEP2_SQL);
  console.log(`STEP 2 UPDATE executed. Rows affected: ${result}`);

  console.log("\n--- Re-running STEP 1's SELECT (idempotency check) ---");
  const rows = await prisma.$queryRawUnsafe<any[]>(STEP1_SQL);
  console.log(`Row count now: ${rows.length}`);
  if (rows.length > 0) console.log(rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

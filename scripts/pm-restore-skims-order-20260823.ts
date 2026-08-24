// One-off manual data restore, owner-directed sidebar (TASKS.md, 2026-08-23).
// Restores a single soft-deleted Order (SKIMS, SB33487073) that the owner
// confirmed was a legitimate order, not junk. Read-verifies the row matches
// expectations before writing anything; writes only Order.deletedAt on this
// one row. Does not touch linked Email rows.
// Usage: npx tsx scripts/pm-restore-skims-order-20260823.ts [--write]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_ID = "cmsfaw3u00001w9q4vxsjeqqe";
const EXPECTED_USER_ID = "cmqtng57q0000w9y3bzaeax0n";
const EXPECTED_RETAILER = "SKIMS";
const EXPECTED_ORDER_NUMBER = "SB33487073";

async function main() {
  const shouldWrite = process.argv.includes("--write");

  const order = await prisma.order.findUnique({
    where: { id: ORDER_ID },
    select: {
      id: true,
      userId: true,
      retailer: true,
      orderNumber: true,
      deletedAt: true,
    },
  });

  if (!order) {
    console.error(`No Order found with id ${ORDER_ID}. Stopping — nothing written.`);
    process.exitCode = 1;
    return;
  }

  console.log("Read result:");
  console.log(`  id: ${order.id}`);
  console.log(`  userId: ${order.userId}`);
  console.log(`  retailer: ${order.retailer}`);
  console.log(`  orderNumber: ${order.orderNumber}`);
  console.log(`  deletedAt: ${order.deletedAt ? order.deletedAt.toISOString() : "null"}`);

  const mismatches: string[] = [];
  if (order.userId !== EXPECTED_USER_ID) mismatches.push(`userId: expected ${EXPECTED_USER_ID}, got ${order.userId}`);
  if (order.retailer !== EXPECTED_RETAILER) mismatches.push(`retailer: expected ${EXPECTED_RETAILER}, got ${order.retailer}`);
  if (order.orderNumber !== EXPECTED_ORDER_NUMBER) mismatches.push(`orderNumber: expected ${EXPECTED_ORDER_NUMBER}, got ${order.orderNumber}`);
  if (order.deletedAt == null) mismatches.push(`deletedAt: expected non-null (still soft-deleted), got null`);

  if (mismatches.length > 0) {
    console.error("\nMismatch(es) against expected state — stopping, nothing written:");
    mismatches.forEach((m) => console.error(`  - ${m}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nRead matches expected state (right order, right user, still soft-deleted).");

  if (!shouldWrite) {
    console.log("\nDry run only (no --write flag). No write performed.");
    return;
  }

  const before = order.deletedAt!.toISOString();

  const updated = await prisma.order.update({
    where: { id: ORDER_ID },
    data: { deletedAt: null },
    select: { id: true, deletedAt: true },
  });

  console.log("\nWrite complete.");
  console.log(`  before deletedAt: ${before}`);
  console.log(`  after deletedAt: ${updated.deletedAt === null ? "null" : updated.deletedAt}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

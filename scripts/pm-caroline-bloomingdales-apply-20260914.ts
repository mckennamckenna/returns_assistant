// Step 3 — apply the owner-approved manual overrides for Caroline's
// Bloomingdale's orders. TASKS.md 🔴 Now, 2026-09-14. Owner approved
// both rows, both to returnWindowDays=30 from delivery,
// policySource='manual_override'. Zero Anthropic calls.
// Usage: npx tsx scripts/pm-caroline-bloomingdales-apply-20260914.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

const APPROVED_ORDER_IDS = ["cmtrpvmcx0003l7045cbhmsgx", "cmts5rxus001yw9hv736f6gqj"];

async function main() {
  for (const id of APPROVED_ORDER_IDS) {
    const before = await prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        retailer: true,
        returnWindowDays: true,
        returnDeadline: true,
        returnWindowStartsFrom: true,
        policySource: true,
        deliveredAt: true,
        userId: true,
      },
    });

    if (before.retailer?.toLowerCase() !== "bloomingdale's" || !before.deliveredAt) {
      throw new Error(`Guard failed for ${id}: retailer=${before.retailer} deliveredAt=${before.deliveredAt} — refusing to write`);
    }

    const newDeadline = addDays(before.deliveredAt, 30);

    const after = await prisma.order.update({
      where: { id },
      data: {
        returnWindowDays: 30,
        returnWindowStartsFrom: "delivery_date",
        returnDeadline: newDeadline,
        policySource: "manual_override",
      },
      select: {
        returnWindowDays: true,
        returnDeadline: true,
        returnWindowStartsFrom: true,
        policySource: true,
      },
    });

    console.log(`Order ${id} (orderNumber=${before.orderNumber}):`);
    console.log(
      `  returnWindowDays:       ${before.returnWindowDays ?? "(null)"} -> ${after.returnWindowDays}`,
    );
    console.log(
      `  returnWindowStartsFrom: ${before.returnWindowStartsFrom ?? "(null)"} -> ${after.returnWindowStartsFrom}`,
    );
    console.log(
      `  returnDeadline:         ${before.returnDeadline?.toISOString() ?? "(null)"} -> ${after.returnDeadline?.toISOString()}`,
    );
    console.log(`  policySource:           ${before.policySource ?? "(null)"} -> ${after.policySource}`);
    console.log(`  write confirmed via update() return value.\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Backfill: auto-archive existing orders that are already displayStatus =
// "refunded" from before the refunded-misclick fix, which made "Mark as
// refunded" auto-archive in the same write going forward. Orders refunded
// prior to that fix never got archivedAt set.
//
// Usage:
//   npx tsx scripts/backfill-refunded-archive.ts          # dry run
//   npx tsx scripts/backfill-refunded-archive.ts --apply  # apply
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.order.findMany({
    where: { displayStatus: "refunded", archivedAt: null },
    select: { id: true, retailer: true, orderNumber: true },
  });

  console.log(`Found ${candidates.length} refunded order(s) with no archivedAt.\n`);

  for (const order of candidates) {
    console.log(`  ${DRY_RUN ? "WOULD UPDATE" : "UPDATING"} ${order.retailer} #${order.orderNumber} (${order.id}) — set archivedAt = now`);

    if (!DRY_RUN) {
      await prisma.order.update({
        where: { id: order.id },
        data: { archivedAt: new Date() },
      });
    }
  }

  console.log();
  console.log(
    DRY_RUN
      ? `Dry run complete. Would update ${candidates.length} order(s).`
      : `Done. Updated ${candidates.length} order(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

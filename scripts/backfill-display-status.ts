// Backfill: recompute displayStatus for all orders where it is stuck at the
// migration default ("ordered") despite having email types that should have
// advanced it. Caused by orders whose last email arrived before the
// displayStatus feature was deployed (2026-07-01) — recomputeDisplayStatus
// is forward-going (fires on linkEmailToOrder) but was never run retroactively.
//
// Usage:
//   npx tsx scripts/backfill-display-status.ts          # dry run
//   npx tsx scripts/backfill-display-status.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { deriveDisplayStatus } from "@/lib/displayStatus";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  // Find every order where displayStatus might be stale: currently "ordered"
  // but has at least one email type that should advance it.
  const candidates = await prisma.order.findMany({
    where: {
      displayStatus: "ordered",
      emails: {
        some: {
          emailType: {
            in: ["shipping_confirmation", "delivery", "return_label", "refund"],
          },
        },
      },
    },
    include: {
      emails: { select: { emailType: true } },
    },
  });

  console.log(`Found ${candidates.length} order(s) with potentially stale displayStatus.\n`);

  let changed = 0;
  let unchanged = 0;

  for (const order of candidates) {
    const emailTypes = order.emails
      .map((e) => e.emailType)
      .filter((t): t is string => t != null);

    const derived = deriveDisplayStatus(emailTypes, order.displayStatus);

    if (derived === order.displayStatus) {
      console.log(`  SKIP ${order.retailer} #${order.orderNumber} — derived "${derived}" (no change)`);
      unchanged++;
      continue;
    }

    console.log(
      `  ${DRY_RUN ? "WOULD UPDATE" : "UPDATING"} ${order.retailer} #${order.orderNumber}` +
        ` — "${order.displayStatus}" → "${derived}"` +
        ` (email types: ${[...new Set(emailTypes)].sort().join(", ")})`,
    );

    if (!DRY_RUN) {
      await prisma.order.update({
        where: { id: order.id },
        data: { displayStatus: derived },
      });
    }
    changed++;
  }

  console.log();
  console.log(
    DRY_RUN
      ? `Dry run complete. Would update ${changed} order(s), skip ${unchanged}.`
      : `Done. Updated ${changed} order(s), skipped ${unchanged}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

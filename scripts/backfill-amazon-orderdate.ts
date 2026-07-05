// Backfill: apply the generalized orderDate fallback (Bug 8) to the 3 real
// Amazon orders diagnosed while building this fix — Amazon never produces
// an order_confirmation emailType, so the old order_confirmation-scoped
// fallback in lib/linkOrder.ts never found a candidate for them.
// Reuses applyFallbackOrderDate directly rather than duplicating its logic.
//
// Scoped to retailer "amazon" deliberately: other orders with orderDate =
// null (H&M, Tuckernuck, Lola Blankets, at last count) are separate, not-yet
// -scoped issues — see TASKS.md — not silently swept up by this script.
//
// Usage:
//   npx tsx scripts/backfill-amazon-orderdate.ts          # dry run
//   npx tsx scripts/backfill-amazon-orderdate.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { applyFallbackOrderDate } from "@/lib/linkOrder";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.order.findMany({
    where: { orderDate: null, retailer: { contains: "amazon", mode: "insensitive" } },
    select: { id: true, retailer: true, orderNumber: true },
  });

  console.log(`Found ${candidates.length} Amazon order(s) with no orderDate.\n`);

  for (const order of candidates) {
    if (DRY_RUN) {
      const emails = await prisma.email.findMany({
        where: { orderId: order.id },
        orderBy: { receivedAt: "asc" },
        select: { emailType: true, receivedAt: true },
      });
      const earliest = emails[0];
      console.log(
        `  WOULD UPDATE ${order.retailer} #${order.orderNumber} (${order.id})` +
          ` — earliest linked email: ${earliest?.emailType ?? "(none)"} at ${earliest?.receivedAt.toISOString() ?? "n/a"}` +
          ` → orderDate would become that email's forwarded-header date, or receivedAt if no header date is parseable`,
      );
    } else {
      await applyFallbackOrderDate(order.id);
      const updated = await prisma.order.findUnique({
        where: { id: order.id },
        select: { orderDate: true, orderDateEstimated: true, returnDeadline: true },
      });
      console.log(
        `  UPDATED ${order.retailer} #${order.orderNumber} (${order.id})` +
          ` — orderDate: ${updated?.orderDate?.toISOString() ?? "(still null — no linked emails at all)"}` +
          `, orderDateEstimated: ${updated?.orderDateEstimated}, returnDeadline: ${updated?.returnDeadline?.toISOString() ?? "null"}`,
      );
    }
  }

  console.log();
  console.log(
    DRY_RUN
      ? `Dry run complete. Would update up to ${candidates.length} order(s).`
      : `Done. Processed ${candidates.length} order(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// One-time backfill for the AquaTru "Shipped forever" fix (lib/displayStatus.ts):
// recomputeDisplayStatus() only fires on new email ingestion, so any order
// that already qualifies for "delivered" but was linked/recomputed before
// this deploy stays stuck at its old displayStatus ("ordered" or "shipped")
// until a future email touches it — this backfill re-derives those existing
// rows once, immediately.
//
// Scoped to displayStatus in (ordered, shipped) AND (deliveredAt != null OR
// a linked "delivery"-type email exists) — widened 2026-07-23 alongside the
// ladder itself (deriveDisplayStatus now treats a "delivery"-type email as
// confirmed delivery evidence even with no extractable date). The original
// deliveredAt-only scope is exactly why AquaTru was excluded from the first
// backfill run — its two "delivery" emails both have deliveredAt: null.
// Orders already at return_requested/returned/refunded/kept are untouched —
// deriveDisplayStatus's own never-downgrade rule would leave them alone
// anyway, this scope just skips the no-op query.
//
// Reuses recomputeDisplayStatus() directly for --apply rather than
// duplicating its logic, so this can't drift from the real derivation path
// (same function every email-triggered recompute uses).
//
// Usage:
//   npx tsx scripts/backfill-delivered-status.ts          # dry run
//   npx tsx scripts/backfill-delivered-status.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { deriveDisplayStatus } from "@/lib/displayStatus";
import { recomputeDisplayStatus } from "@/lib/linkOrder";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.order.findMany({
    where: {
      displayStatus: { in: ["ordered", "shipped"] },
      OR: [{ deliveredAt: { not: null } }, { emails: { some: { emailType: "delivery" } } }],
    },
    select: { id: true, retailer: true, orderNumber: true, displayStatus: true, deliveredAt: true },
  });

  console.log(`Found ${candidates.length} order(s) with delivered evidence (deliveredAt or a "delivery" email) but displayStatus stuck below "delivered".\n`);

  let changed = 0;
  let unchanged = 0;

  for (const order of candidates) {
    if (DRY_RUN) {
      const emails = await prisma.email.findMany({
        where: { orderId: order.id },
        select: { emailType: true, refundAmount: true, refundAmountConfidence: true },
      });
      const emailTypes = emails.map((e) => e.emailType).filter((t): t is string => t != null);
      const hasConfirmedRefundAmount = emails.some(
        (e) => e.emailType === "refund" && e.refundAmount != null && e.refundAmountConfidence !== "low",
      );
      const derived = deriveDisplayStatus(emailTypes, order.displayStatus, hasConfirmedRefundAmount, order.deliveredAt);

      if (derived === order.displayStatus) {
        console.log(`  SKIP ${order.retailer} #${order.orderNumber} — derived "${derived}" (no change)`);
        unchanged++;
        continue;
      }
      console.log(
        `  WOULD UPDATE ${order.retailer} #${order.orderNumber} — "${order.displayStatus}" → "${derived}"` +
          ` (deliveredAt: ${order.deliveredAt?.toISOString()})`,
      );
      changed++;
    } else {
      const before = order.displayStatus;
      await recomputeDisplayStatus(order.id);
      const updated = await prisma.order.findUnique({ where: { id: order.id }, select: { displayStatus: true } });
      if (updated?.displayStatus === before) {
        console.log(`  SKIP ${order.retailer} #${order.orderNumber} — stayed "${before}" (no change)`);
        unchanged++;
      } else {
        console.log(`  UPDATED ${order.retailer} #${order.orderNumber} — "${before}" → "${updated?.displayStatus}"`);
        changed++;
      }
    }
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

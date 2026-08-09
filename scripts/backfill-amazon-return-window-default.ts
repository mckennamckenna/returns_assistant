// Backfill: apply the Amazon 30-day return-window default (TASKS.md 🔴 Now,
// "Amazon return-window default (30 days), forward short-circuit") to the
// tiny existing population the forward rule in lib/extract.ts doesn't touch
// retroactively — Order rows already extracted before this rule existed.
//
// Scope: isAmazonOrder(retailer) AND returnWindowDays === null AND
// needsReview === true. GUARD: orders that already have a returnWindowDays
// (flagged needsReview for an unrelated reason, e.g. tier/category
// confidence from a prior web_lookup) are never touched — this only
// widens/tightens if returnWindowDays is genuinely null. Non-Amazon orders
// are excluded by the isAmazonOrder() filter itself.
//
// Usage:
//   npx tsx scripts/backfill-amazon-return-window-default.ts          # dry run
//   npx tsx scripts/backfill-amazon-return-window-default.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { computeDeadline } from "@/lib/extract";
import { recomputeOrderStatus } from "@/lib/linkOrder";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");
const AMAZON_DEFAULT_RETURN_WINDOW_DAYS = 30;

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const flagged = await prisma.order.findMany({
    where: { needsReview: true },
    include: { emails: { select: { subject: true, orderNumber: true, extractionNotes: true } } },
  });
  const amazonFlagged = flagged.filter((o) => isAmazonOrder(o.retailer));
  const candidates = amazonFlagged.filter((o) => o.returnWindowDays == null);
  const guardRows = amazonFlagged.filter((o) => o.returnWindowDays != null);

  console.log(`Amazon orders flagged needsReview=true: ${amazonFlagged.length}`);
  console.log(`  -> null-window candidates (this backfill touches these): ${candidates.length}`);
  console.log(`  -> GUARD, already has a window, NOT touched: ${guardRows.length}`);
  guardRows.forEach((o) => console.log(`       id=${o.id} returnWindowDays=${o.returnWindowDays} policySource=${o.policySource}`));
  console.log();

  for (const o of candidates) {
    const { returnDeadline, deadlineIsEstimated } = computeDeadline({
      orderDate: o.orderDate?.toISOString() ?? null,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      estimatedDeliveryDate: o.estimatedDeliveryDate?.toISOString() ?? null,
      returnWindowDays: AMAZON_DEFAULT_RETURN_WINDOW_DAYS,
      returnWindowStartsFrom: o.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
    });

    console.log(`--- Order ${o.id} (${o.retailer}, ${o.orderNumber ?? "no order number"}) ---`);
    console.log(`  subjects: ${o.emails.map((e) => e.subject).join(" | ")}`);
    console.log(`  BEFORE: returnWindowDays=${o.returnWindowDays} policySource=${o.policySource} returnDeadline=${o.returnDeadline?.toISOString() ?? "null"} deadlineIsEstimated=${o.deadlineIsEstimated} needsReview=${o.needsReview}`);
    console.log(`  AFTER:  returnWindowDays=${AMAZON_DEFAULT_RETURN_WINDOW_DAYS} policySource=amazon_default returnDeadline=${returnDeadline ?? "null"} deadlineIsEstimated=${deadlineIsEstimated} needsReview=<recomputed below>`);

    if (!DRY_RUN) {
      await prisma.order.update({
        where: { id: o.id },
        data: {
          returnWindowDays: AMAZON_DEFAULT_RETURN_WINDOW_DAYS,
          policySource: "amazon_default",
          returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
          deadlineIsEstimated,
        },
      });
      await recomputeOrderStatus(o.id);
      const after = await prisma.order.findUnique({ where: { id: o.id } });
      console.log(`  VERIFIED: needsReview is now ${after?.needsReview}, status is now ${after?.status}`);
    }
    console.log();
  }

  console.log(`Done. ${DRY_RUN ? "0 writes (dry run)." : `${candidates.length} order(s) updated.`}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

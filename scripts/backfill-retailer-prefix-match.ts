// Retroactively merges Orders created in the last 48 hours that should have
// linked to an existing Order via the new retailer-prefix fallback but didn't
// (because that fallback didn't exist yet when they were created).
//
// Usage:
//   npx tsx scripts/backfill-retailer-prefix-match.ts          # dry run
//   npx tsx scripts/backfill-retailer-prefix-match.ts --apply  # apply merges
import { PrismaClient } from "@prisma/client";
import { isRetailerPrefixMatch, mergeEmailIntoOrder, applyFallbackOrderDate, recomputeOrderStatus } from "@/lib/linkOrder";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");
const LOOKBACK_HOURS = 48;

async function main() {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  console.log(`\nOrders created after ${cutoff.toISOString()} (last ${LOOKBACK_HOURS}h)`);
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING — merges will execute");
  console.log();

  const recentOrders = await prisma.order.findMany({
    where: { createdAt: { gte: cutoff } },
    include: { emails: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${recentOrders.length} recently-created Order(s)\n`);

  // Collect merge plan first so dry-run output is complete before any writes.
  type MergePlan = {
    emailId: string;
    emailSubject: string | null;
    sourceOrderId: string;
    sourceRetailer: string | null;
    sourceOrderNumber: string | null;
    targetOrderId: string;
    targetRetailer: string | null;
    targetOrderNumber: string | null;
  };
  const plan: MergePlan[] = [];

  for (const order of recentOrders) {
    for (const email of order.emails) {
      if (!email.retailer || !email.orderNumber) continue;

      // Find any other order for this user with the same order number
      // whose retailer is a prefix match of this email's retailer.
      const candidates = await prisma.order.findMany({
        where: {
          userId: email.userId,
          orderNumber: { equals: email.orderNumber, mode: "insensitive" },
          id: { not: order.id },
        },
      });

      // Only merge into an order that is OLDER than the current one.
      // Both orders can be "recent" (created within 48h of each other), so
      // without this guard the plan would contain circular swaps: email A
      // re-linking into the newer order, and email B re-linking back into the
      // older one. The older order was created from the first email and
      // carries the more authoritative retailer name (typically from the order
      // confirmation); the newer, erroneously-created order is the one to dissolve.
      const target = candidates.find(
        (c) =>
          c.retailer != null &&
          isRetailerPrefixMatch(c.retailer, email.retailer!) &&
          c.createdAt < order.createdAt,
      );

      if (target) {
        plan.push({
          emailId: email.id,
          emailSubject: email.subject,
          sourceOrderId: order.id,
          sourceRetailer: order.retailer,
          sourceOrderNumber: order.orderNumber,
          targetOrderId: target.id,
          targetRetailer: target.retailer,
          targetOrderNumber: target.orderNumber,
        });
      }
    }
  }

  if (plan.length === 0) {
    console.log("Nothing to merge — no retailer-prefix mismatches found in the last 48h.");
    return;
  }

  console.log(`Found ${plan.length} email(s) to re-link:\n`);
  for (const p of plan) {
    console.log(`  Email:   "${p.emailSubject}" (${p.emailId})`);
    console.log(`  From:    Order ${p.sourceOrderId} (retailer="${p.sourceRetailer}", #${p.sourceOrderNumber})`);
    console.log(`  Into:    Order ${p.targetOrderId} (retailer="${p.targetRetailer}", #${p.targetOrderNumber})`);
    console.log();
  }

  if (DRY_RUN) {
    console.log("Dry run complete. To apply:");
    console.log("  npx tsx scripts/backfill-retailer-prefix-match.ts --apply");
    return;
  }

  // Apply: merge each email directly into its target order, bypassing the
  // normal match step. We can't re-run linkEmailToOrder here because the
  // source order (e.g. "Proenza") still exists in the DB with the same
  // orderNumber, so the exact-match query finds it first and the email bounces
  // back to the source. Calling mergeEmailIntoOrder directly avoids that lookup.
  const deletedOrderIds = new Set<string>();

  for (const p of plan) {
    console.log(`Merging email ${p.emailId} into Order ${p.targetOrderId}...`);

    const email = await prisma.email.findUniqueOrThrow({ where: { id: p.emailId } });
    const targetOrder = await prisma.order.findUniqueOrThrow({ where: { id: p.targetOrderId } });

    // Merge the email's data into the target order (same logic as the live linker).
    await mergeEmailIntoOrder(targetOrder, email, null);
    // Point the email at its new home.
    await prisma.email.update({ where: { id: p.emailId }, data: { orderId: p.targetOrderId } });
    // Re-run deadline and status from the merged state.
    await applyFallbackOrderDate(p.targetOrderId);
    await recomputeOrderStatus(p.targetOrderId);
    // Flag for human review and log the merge reason, same as the live linker.
    const merged = await prisma.order.findUnique({ where: { id: p.targetOrderId }, select: { userNote: true } });
    const prior = merged?.userNote ?? null;
    const note = `[auto] retailer prefix match: "${p.targetRetailer}" ← "${p.sourceRetailer}"`;
    await prisma.order.update({
      where: { id: p.targetOrderId },
      data: { needsReview: true, userNote: prior ? `${prior}\n${note}` : note },
    });

    const remaining = await prisma.email.count({ where: { orderId: p.sourceOrderId } });
    if (remaining === 0 && !deletedOrderIds.has(p.sourceOrderId)) {
      await prisma.reminder.deleteMany({ where: { orderId: p.sourceOrderId } });
      await prisma.order.delete({ where: { id: p.sourceOrderId } });
      deletedOrderIds.add(p.sourceOrderId);
      console.log(`  Deleted empty Order ${p.sourceOrderId} (${p.sourceRetailer}, #${p.sourceOrderNumber})`);
    }
  }

  console.log(`\nDone. Merged ${plan.length} email(s), deleted ${deletedOrderIds.size} empty Order(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// One-time backfill after two computeDeadline() changes (lib/extract.ts,
// 2026-07-15, sidekick-deadline-anchor-mismatch):
//   Decision 1: returnWindowStartsFrom === null (unknown/ambiguous anchor)
//     now anchors directly on orderDate, not a delivery-plus-buffer guess.
//   Decision 2: the STANDARD_SHIPPING_DAYS buffer (used when the policy is
//     explicitly delivery_date-anchored but no real delivery signal exists)
//     tightens 7 -> 5 days.
// Recomputes every active order's returnDeadline/deadlineIsEstimated from
// its EXISTING orderDate/deliveredAt/estimatedDeliveryDate/returnWindowDays/
// returnWindowStartsFrom — never re-derives those input fields themselves
// (see backfill-return-window-starts-from.ts's note on why re-deriving
// dates risks reintroducing timezone drift).
//
// Scoped to currently-active orders only (displayStatus in ordered/shipped/
// return_requested, not deleted/archived) per the standing "silent
// correction only when it tightens a deadline" precedent (Caroline's Moda
// backfill). Both of this session's changes only ever tighten (move
// earlier) or leave unchanged a computed deadline — this script asserts
// that invariant against real data and refuses to write anything if it
// finds a counterexample, rather than assuming the math is safe.
//
// Usage:
//   npx tsx scripts/backfill-deadline-anchor-and-buffer.ts          # dry run
//   npx tsx scripts/backfill-deadline-anchor-and-buffer.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      displayStatus: { in: ["ordered", "shipped", "return_requested"] },
      returnWindowDays: { not: null },
    },
  });

  console.log(`Checking ${orders.length} active order(s).\n`);

  const diffs: {
    id: string;
    retailer: string | null;
    orderNumber: string | null;
    oldDeadline: Date | null;
    newDeadline: Date | null;
    deltaDays: number | null;
    oldEstimated: boolean;
    newEstimated: boolean;
  }[] = [];

  for (const order of orders) {
    const { returnDeadline, deadlineIsEstimated } = computeDeadline({
      orderDate: order.orderDate ? order.orderDate.toISOString() : null,
      deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
      estimatedDeliveryDate: order.estimatedDeliveryDate ? order.estimatedDeliveryDate.toISOString() : null,
      returnWindowDays: order.returnWindowDays,
      returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
    });

    const newDeadline = returnDeadline ? new Date(returnDeadline) : null;
    const deadlineChanged = (newDeadline?.getTime() ?? null) !== (order.returnDeadline?.getTime() ?? null);
    const estimatedChanged = deadlineIsEstimated !== order.deadlineIsEstimated;

    if (!deadlineChanged && !estimatedChanged) continue;

    const deltaDays =
      order.returnDeadline && newDeadline
        ? Math.round((newDeadline.getTime() - order.returnDeadline.getTime()) / (24 * 60 * 60 * 1000))
        : null;

    diffs.push({
      id: order.id,
      retailer: order.retailer,
      orderNumber: order.orderNumber,
      oldDeadline: order.returnDeadline,
      newDeadline,
      deltaDays,
      oldEstimated: order.deadlineIsEstimated,
      newEstimated: deadlineIsEstimated,
    });
  }

  console.log(`${diffs.length} order(s) affected:\n`);
  for (const d of diffs) {
    console.log(
      `  ${d.retailer} #${d.orderNumber}  (${d.id})\n` +
        `    deadline: ${d.oldDeadline?.toISOString().slice(0, 10) ?? "null"} -> ${d.newDeadline?.toISOString().slice(0, 10) ?? "null"}` +
        `  (delta: ${d.deltaDays === null ? "n/a" : (d.deltaDays > 0 ? "+" : "") + d.deltaDays + "d"})\n` +
        `    estimated: ${d.oldEstimated} -> ${d.newEstimated}`,
    );
  }
  console.log();

  const loosened = diffs.filter((d) => d.deltaDays !== null && d.deltaDays > 0);
  if (loosened.length > 0) {
    console.error(
      `ABORTING — ${loosened.length} order(s) would have their deadline LOOSENED (moved later),` +
        ` which violates the silent-correction-only-tightens precedent. Refusing to write anything.`,
    );
    for (const d of loosened) {
      console.error(`    ${d.retailer} #${d.orderNumber} (${d.id}): +${d.deltaDays}d`);
    }
    process.exitCode = 1;
    return;
  }

  if (DRY_RUN) {
    console.log("Dry run complete — no writes made. Re-run with --apply to write these changes.");
    return;
  }

  let written = 0;
  for (const d of diffs) {
    await prisma.order.update({
      where: { id: d.id },
      data: { returnDeadline: d.newDeadline, deadlineIsEstimated: d.newEstimated },
    });
    written++;
  }
  console.log(`Done. Updated ${written} order(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

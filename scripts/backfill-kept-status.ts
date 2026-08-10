// Backfill: CARD_SPEC.md Part 2 promotes `kept` to a real Order.status value
// so the card-geometry state machine can read `status` uniformly for all six
// states, instead of special-casing keptAt/displayStatus. `status` is a plain
// String column (no Postgres enum) — additive, no schema migration needed.
//
// Scope confirmed via read-only census (Step 0, 2026-08-10): displayStatus
// === "kept" and keptAt !== null identify the exact same 33 rows, no
// mismatches — so either predicate is equivalent here.
//
// Usage:
//   npx tsx scripts/backfill-kept-status.ts          # dry run
//   npx tsx scripts/backfill-kept-status.ts --apply  # apply
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.order.findMany({
    where: { displayStatus: "kept", status: { not: "kept" } },
    select: { id: true, retailer: true, status: true },
  });

  console.log(`Found ${candidates.length} order(s) with displayStatus "kept" but status !== "kept".\n`);

  for (const order of candidates) {
    console.log(`  ${DRY_RUN ? "WOULD UPDATE" : "UPDATING"} ${order.retailer ?? "?"} (${order.id}): status "${order.status}" -> "kept"`);
    if (!DRY_RUN) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "kept" } });
    }
  }

  console.log(`\n${DRY_RUN ? "Would update" : "Updated"} ${candidates.length} row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

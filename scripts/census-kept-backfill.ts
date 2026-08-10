// READ-ONLY census for the CARD_SPEC.md `kept` status backfill (Step 0).
// Lists the 33 orders that would be backfilled: user, retailer, current
// internal status, keptAt. Zero writes.
//
// Usage: npx tsx scripts/census-kept-backfill.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("KEPT BACKFILL CENSUS — READ ONLY. Zero writes.\n");

  const rows = await prisma.order.findMany({
    where: { displayStatus: "kept" },
    select: {
      id: true,
      retailer: true,
      status: true,
      keptAt: true,
      user: { select: { email: true } },
    },
    orderBy: [{ user: { email: "asc" } }, { keptAt: "asc" }],
  });

  console.log(`${rows.length} rows\n`);
  for (const r of rows) {
    console.log(
      `${r.user.email.padEnd(30)} ${(r.retailer ?? "—").padEnd(20)} status=${r.status.padEnd(12)} keptAt=${r.keptAt?.toISOString().slice(0, 10)} id=${r.id}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Historical emailType census (TASKS.md, 2026-08-05). READ-ONLY — Prisma
// reads only. Does not import runExtraction/extractEmail, by design, so
// this script cannot bill anything.
//
// Usage: npx tsx scripts/census-emailtype-distribution.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("READ ONLY. Zero writes, zero Anthropic calls.\n");

  const total = await prisma.email.count();

  const byType = await prisma.email.groupBy({
    by: ["emailType"],
    _count: { _all: true },
  });

  console.log(`Total emails: ${total}\n`);
  console.log("=== Full emailType distribution ===");
  const sorted = [...byType].sort((a, b) => b._count._all - a._count._all);
  for (const row of sorted) {
    const label = row.emailType ?? "NULL (never resolved)";
    const pct = ((row._count._all / total) * 100).toFixed(1);
    console.log(`  ${label}: ${row._count._all} (${pct}%)`);
  }

  // "Processed" = extraction was actually attempted (billed), regardless of
  // outcome: either it resolved a real emailType (success, including
  // "other"), or it's still emailType:null but extractedAt is set (ran and
  // failed — same runExtraction.ts catch-block fingerprint used throughout
  // the Aug-4 backfill). Rows with BOTH emailType:null AND extractedAt:null
  // never reached the Sonnet call at all — never billed, excluded from the
  // "processed" denominator on purpose.
  const processedCount = await prisma.email.count({
    where: { OR: [{ emailType: { not: null } }, { extractedAt: { not: null } }] },
  });
  const neverProcessedCount = total - processedCount;
  const otherCount = await prisma.email.count({ where: { emailType: "other" } });

  console.log(`\n=== The cost-relevant cut ===`);
  console.log(`Processed (extraction attempted, billed regardless of outcome): ${processedCount}`);
  console.log(`Never processed (emailType:null AND extractedAt:null — never billed): ${neverProcessedCount}`);
  console.log(`\n"other"-typed emails: ${otherCount}`);
  console.log(`  as % of ALL emails: ${((otherCount / total) * 100).toFixed(1)}%`);
  console.log(`  as % of PROCESSED (billed) emails — THE HEADLINE NUMBER: ${((otherCount / processedCount) * 100).toFixed(1)}%`);

  const otherJunked = await prisma.email.count({ where: { emailType: "other", junkedAt: { not: null } } });
  const otherLive = otherCount - otherJunked;
  console.log(`\n=== Junk interaction, "other"-typed emails ===`);
  console.log(`Already junked (junkedAt set): ${otherJunked} (${((otherJunked / otherCount) * 100).toFixed(1)}% of "other")`);
  console.log(`Still live (junkedAt null): ${otherLive} (${((otherLive / otherCount) * 100).toFixed(1)}% of "other")`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// READ-ONLY verification after the Phase B run crashed partway through
// (dropped DB connection, P1017) — confirms actual state before deciding
// whether/how to resume. Zero writes, zero Anthropic calls.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const OUTAGE_START = new Date("2026-08-01T12:08:00.000Z");

async function main() {
  const stillNull = await prisma.email.findMany({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: null },
    select: { id: true, receivedAt: true, extractedAt: true },
    orderBy: { receivedAt: "asc" },
  });
  const nowFixed = await prisma.email.count({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: { not: null } },
  });

  console.log(`Still emailType:null in the target window: ${stillNull.length}`);
  console.log(`Now emailType-set (fixed) in the target window: ${nowFixed}`);
  console.log(`\nRemaining rows:`);
  for (const r of stillNull) console.log(`  ${r.id} | ${r.receivedAt.toISOString()} | extractedAt=${r.extractedAt?.toISOString() ?? "null"}`);
}

main().finally(() => prisma.$disconnect());

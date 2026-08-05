// READ-ONLY final summary of the Phase B backfill's effect on the original
// 104-row target set. Zero writes, zero Anthropic calls.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const OUTAGE_START = new Date("2026-08-01T12:08:00.000Z");

async function main() {
  const targetNow = await prisma.email.findMany({
    where: { receivedAt: { gte: OUTAGE_START } },
    select: { id: true, emailType: true, orderId: true, needsReview: true, retailer: true },
  });

  const stillNull = targetNow.filter((e) => e.emailType === null);
  const byType = new Map<string, number>();
  let linked = 0;
  for (const e of targetNow) {
    if (e.emailType) byType.set(e.emailType, (byType.get(e.emailType) ?? 0) + 1);
    if (e.orderId) linked++;
  }

  console.log(`Total emails in window now: ${targetNow.length}`);
  console.log(`Still emailType:null: ${stillNull.length} (${stillNull.map((e) => e.id).join(", ")})`);
  console.log(`Linked to an order (orderId set): ${linked}`);
  console.log(`\nemailType breakdown:`);
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
}

main().finally(() => prisma.$disconnect());

// Follow-up sanity check, READ-ONLY, zero writes, zero Anthropic calls.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const OUTAGE_START = new Date("2026-08-01T12:08:00.000Z");
  const nonNullRetailer = await prisma.email.count({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: null, retailer: { not: null } },
  });
  console.log(`Target-set rows with a non-null retailer despite emailType:null: ${nonNullRetailer} (expect 0)`);
}
main().finally(() => prisma.$disconnect());

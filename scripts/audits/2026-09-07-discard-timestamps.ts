import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.discardLog.findMany({
    where: {
      reason: "self_outbound_loop",
      occurredAt: { gte: new Date("2026-09-04T00:00:00Z"), lt: new Date("2026-09-07T00:00:00Z") },
    },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });
  console.log(JSON.stringify(rows.map(r => r.occurredAt.toISOString())));
}
main().finally(() => prisma.$disconnect());

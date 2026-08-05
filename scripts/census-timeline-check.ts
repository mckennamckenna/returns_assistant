// Follow-up investigation, READ-ONLY, zero writes, zero Anthropic calls.
// Characterizes the emailType:null failures found just before the owner's
// stated outage start (2026-08-01T12:08:00Z) to determine whether the real
// failure boundary is earlier than reported.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const from = new Date("2026-07-31T00:00:00.000Z");
  const to = new Date("2026-08-01T13:00:00.000Z");

  const all = await prisma.email.findMany({
    where: { receivedAt: { gte: from, lte: to } },
    select: { id: true, receivedAt: true, emailType: true, extractedAt: true },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`All emails 2026-07-31T00:00Z .. 2026-08-01T13:00Z: ${all.length}\n`);
  for (const e of all) {
    console.log(
      `${e.receivedAt.toISOString()} | ${e.id} | emailType=${e.emailType ?? "NULL"} | extractedAt=${e.extractedAt?.toISOString() ?? "null"}`,
    );
  }

  const failed = all.filter((e) => e.emailType === null);
  const healthy = all.filter((e) => e.emailType !== null);
  console.log(`\nFailed (emailType:null): ${failed.length}`);
  console.log(`Healthy (emailType set): ${healthy.length}`);

  if (failed.length > 0) {
    console.log(`\nEarliest failure in this range: ${failed[0].receivedAt.toISOString()} (${failed[0].id})`);
    console.log(`Latest failure in this range: ${failed[failed.length - 1].receivedAt.toISOString()} (${failed[failed.length - 1].id})`);
  }
  if (healthy.length > 0) {
    const lastHealthyBeforeFailures = [...healthy].reverse().find((h) => failed.length === 0 || h.receivedAt < failed[0].receivedAt);
    console.log(`Last confirmed-healthy extraction before the failure run: ${lastHealthyBeforeFailures?.receivedAt.toISOString() ?? "none found in range"} (${lastHealthyBeforeFailures?.id ?? "n/a"})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

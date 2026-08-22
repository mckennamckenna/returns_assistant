// READ-ONLY repro of app/api/cron/weekly-coverage/route.ts's exact query
// logic, scoped to mckenna.sweazey@gmail.com only, to explain a specific
// received digest. No writes, no Anthropic calls, no Reminder rows touched.
//
// Usage: npx tsx scripts/pm-repro-coverage-digest-mckenna.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 7;

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "mckenna.sweazey@gmail.com" } });
  if (!user) {
    console.log("User not found.");
    return;
  }

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`Repro window (rolling 7-day from right now): ${lookbackStart.toISOString()} -> ${now.toISOString()}\n`);

  const recentEmails = await prisma.email.findMany({
    where: { userId: user.id, receivedAt: { gte: lookbackStart }, junkedAt: null },
    include: { order: { select: { retailer: true, orderTotal: true, orderCurrency: true, orderDate: true } } },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Emails matching the digest's raw query (unjunked, received in window): ${recentEmails.length}\n`);
  for (const e of recentEmails) {
    console.log(
      `${e.id} | received=${e.receivedAt.toISOString()} | type=${e.emailType ?? "null"} | orderId=${e.orderId ?? "null"} | retailer=${e.retailer ?? "null"} | orderNumber=${e.orderNumber ?? "null"} | subject="${e.subject ?? ""}" | linkedOrder.retailer=${e.order?.retailer ?? "n/a"} | linkedOrder.orderDate=${e.order?.orderDate?.toISOString() ?? "n/a"}`,
    );
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

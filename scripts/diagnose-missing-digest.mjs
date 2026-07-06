import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "mckenna.sweazey@gmail.com" } });
  if (!user) { console.log("User not found"); return; }
  console.log(`User: ${user.id} (${user.email})`);

  console.log("\n=== Reminder rows, any type, last 72h ===");
  const recentReminders = await prisma.reminder.findMany({
    where: { userId: user.id, sentAt: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) } },
    orderBy: { sentAt: "desc" },
  });
  for (const r of recentReminders) {
    console.log(`  ${r.id}  type=${r.reminderType}  orderId=${r.orderId ?? "(none)"}  sentAt=${r.sentAt.toISOString()}`);
  }
  if (recentReminders.length === 0) console.log("  (none)");

  console.log("\n=== weekly_digest rows, ALL TIME (to check prior Sundays) ===");
  const allDigests = await prisma.reminder.findMany({
    where: { userId: user.id, reminderType: "weekly_digest" },
    orderBy: { sentAt: "desc" },
  });
  for (const r of allDigests) {
    console.log(`  ${r.id}  sentAt=${r.sentAt.toISOString()}  (day: ${r.sentAt.toLocaleDateString("en-US", { weekday: "long" })})`);
  }
  if (allDigests.length === 0) console.log("  (none ever found for this user)");

  console.log("\n=== Manual digest-eligibility query, right now ===");
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const eligible = await prisma.order.findMany({
    where: {
      userId: user.id,
      returnDeadline: { gte: now, lte: in7Days },
      displayStatus: { notIn: ["returned", "refunded"] },
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true, retailer: true, orderNumber: true, returnDeadline: true, displayStatus: true },
  });
  console.log(`Orders eligible for this week's digest (returnDeadline in next 7 days, not returned/refunded, not archived/deleted): ${eligible.length}`);
  for (const o of eligible) {
    console.log(`  ${o.retailer} #${o.orderNumber}  deadline=${o.returnDeadline?.toISOString()}  displayStatus=${o.displayStatus}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

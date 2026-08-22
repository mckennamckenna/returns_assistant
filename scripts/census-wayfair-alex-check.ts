// Targeted check: Alex Moser's Jul 31 Wayfair pair -- one order shown
// twice (linking gap) or two different users' Wayfair orders (the
// cross-user exposure)? READ-ONLY, zero writes, zero Anthropic calls.
//
// Usage: npx tsx scripts/census-wayfair-alex-check.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("WAYFAIR / ALEX MOSER CHECK — READ ONLY.\n");

  const users = await prisma.user.findMany({
    where: { name: { contains: "Alex", mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  console.log("Users matching 'Alex':");
  for (const u of users) console.log(`  ${u.id} | ${u.name} | ${u.email}`);

  const wayfairOrders = await prisma.order.findMany({
    where: { retailer: { contains: "Wayfair", mode: "insensitive" } },
    select: { id: true, userId: true, orderNumber: true, orderDate: true, createdAt: true, deletedAt: true, orderTotal: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\nAll Wayfair Orders (any user), ${wayfairOrders.length} total:`);
  for (const o of wayfairOrders) {
    console.log(
      `  Order ${o.id} | user=${o.userId} | orderNumber=${o.orderNumber ?? "null"} | orderDate=${o.orderDate?.toISOString() ?? "null"} | createdAt=${o.createdAt.toISOString()} | deletedAt=${o.deletedAt?.toISOString() ?? "null"}`,
    );
  }

  const wayfairEmails = await prisma.email.findMany({
    where: { retailer: { contains: "Wayfair", mode: "insensitive" } },
    select: { id: true, userId: true, orderId: true, receivedAt: true, emailType: true, orderNumber: true, needsReview: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`\nAll Wayfair Emails (any user), ${wayfairEmails.length} total:`);
  for (const e of wayfairEmails) {
    console.log(
      `  Email ${e.id} | user=${e.userId} | orderId=${e.orderId ?? "null"} | ${e.receivedAt.toISOString()} | type=${e.emailType} | orderNumber=${e.orderNumber ?? "null"} | needsReview=${e.needsReview}`,
    );
  }

  // Narrow to the Jul 31 window specifically.
  const jul31Start = new Date("2026-07-31T00:00:00.000Z");
  const aug1Start = new Date("2026-08-01T00:00:00.000Z");
  const jul31Wayfair = wayfairEmails.filter((e) => e.receivedAt >= jul31Start && e.receivedAt < aug1Start);
  console.log(`\nWayfair emails specifically on 2026-07-31: ${jul31Wayfair.length}`);
  for (const e of jul31Wayfair) {
    console.log(`  ${e.id} | user=${e.userId} | orderId=${e.orderId ?? "null"}`);
  }

  const distinctUserIds = new Set(wayfairEmails.map((e) => e.userId));
  console.log(`\nDistinct userIds across ALL Wayfair emails: ${distinctUserIds.size} -> ${[...distinctUserIds].join(", ")}`);
  const distinctOrderUserIds = new Set(wayfairOrders.map((o) => o.userId));
  console.log(`Distinct userIds across ALL Wayfair orders: ${distinctOrderUserIds.size} -> ${[...distinctOrderUserIds].join(", ")}`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

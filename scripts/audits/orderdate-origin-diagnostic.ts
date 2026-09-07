// Diagnostic: Order.orderDate for #1RYJR48 is set to the receivedAt of its
// linked order confirmation, but labeled orderDateSource: "extracted" and
// orderDateEstimated: false. TASKS.md 🔴 Now, 2026-09-06.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Prisma reads only.
//
// Usage: npx tsx scripts/audits/orderdate-origin-diagnostic.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: "1RYJR48" },
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      orderDateSource: true,
      orderDateEstimated: true,
      returnDeadline: true,
      returnWindowStartsFrom: true,
    },
  });

  console.log("=== Order ===");
  console.log(JSON.stringify(order, null, 2));

  if (!order) {
    console.log("No Order found with orderNumber 1RYJR48.");
    return;
  }

  const emails = await prisma.email.findMany({
    where: { orderId: order.id },
    select: {
      id: true,
      subject: true,
      receivedAt: true,
      emailType: true,
      extractedAt: true,
      orderDate: true,
      confidence: true,
      needsReview: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log("\n=== Linked Emails ===");
  console.log(JSON.stringify(emails, null, 2));

  console.log("\n=== Match check ===");
  for (const e of emails) {
    const match = order.orderDate && e.receivedAt.getTime() === order.orderDate.getTime();
    console.log(`Email ${e.id} (${e.emailType}) receivedAt=${e.receivedAt.toISOString()} — ${match ? "MATCH" : "no match"} vs Order.orderDate=${order.orderDate?.toISOString()}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

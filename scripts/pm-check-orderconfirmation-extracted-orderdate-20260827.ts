import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const targets = ["54421192781", "143429832"];
  for (const on of targets) {
    const order = await prisma.order.findFirst({ where: { orderNumber: on } });
    const confirmations = await prisma.email.findMany({
      where: { orderId: order?.id, emailType: "order_confirmation" },
      select: { id: true, orderDate: true, anchorDate: true, anchorSource: true, forwardType: true },
    });
    console.log(on, "order_confirmation emails:", confirmations);
  }

  // Also check the 6 flagged "unexplained" orders from the prior diagnosis
  const flaggedNumbers = ["F4VLSF", "424051", "444466", "66993117803", "SK213978", "TNK6875105"];
  for (const on of flaggedNumbers) {
    const order = await prisma.order.findFirst({ where: { orderNumber: on } });
    if (!order) { console.log(on, "order not found"); continue; }
    const confirmations = await prisma.email.findMany({
      where: { orderId: order.id, emailType: "order_confirmation" },
      select: { id: true, orderDate: true, anchorDate: true, anchorSource: true },
    });
    console.log(on, "order_confirmation emails:", confirmations);
  }
}
main().finally(() => prisma.$disconnect());

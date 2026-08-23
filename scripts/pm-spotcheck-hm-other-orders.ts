// READ-ONLY. Zero billed calls. Spot-check that the H&M return_label fix
// (TASKS.md 🔴 Now) didn't regress the two H&M orders that were already
// correctly linked before today's change — deploy step (4).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ORDER_NUMBERS = ["66993117803", "68468087873"];

async function main() {
  for (const orderNumber of ORDER_NUMBERS) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: { emails: { select: { id: true, orderNumber: true, needsReview: true } } },
    });
    console.log(orderNumber, order ? {
      orderId: order.id,
      orderOrderNumber: order.orderNumber,
      retailer: order.retailer,
      status: order.status,
      linkedEmailCount: order.emails.length,
      emails: order.emails,
    } : "NOT FOUND");
  }
}

main().finally(() => prisma.$disconnect());

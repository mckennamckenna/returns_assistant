import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const orders = await prisma.order.findMany({ select: { id: true, retailer: true, orderNumber: true } });
  let count = 0;
  const examples: any[] = [];
  for (const o of orders) {
    const emails = await prisma.email.findMany({
      where: { orderId: o.id },
      select: { emailType: true, receivedAt: true },
    });
    const confirmation = emails.find((e) => e.emailType === "order_confirmation");
    if (!confirmation) continue;
    const earlierShipOrDeliver = emails.find(
      (e) =>
        (e.emailType === "shipping_confirmation" || e.emailType === "delivery") &&
        e.receivedAt.getTime() < confirmation.receivedAt.getTime(),
    );
    if (earlierShipOrDeliver) {
      count++;
      if (examples.length < 15) {
        examples.push({
          id: o.id,
          retailer: o.retailer,
          orderNumber: o.orderNumber,
          orderConfirmationReceivedAt: confirmation.receivedAt,
          earlierShipOrDeliverReceivedAt: earlierShipOrDeliver.receivedAt,
        });
      }
    }
  }
  console.log(`Orders where order_confirmation was received AFTER a shipping_confirmation/delivery email on the same order: ${count} / ${orders.length}`);
  for (const e of examples) console.log(e);
}
main().finally(() => prisma.$disconnect());

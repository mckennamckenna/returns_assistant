import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
const prisma = new PrismaClient();

async function main() {
  for (const orderNumber of ["48868", "1058208405"]) {
    const order = await prisma.order.findFirst({ where: { orderNumber } });
    if (!order) continue;
    console.log(`\n=== ${order.retailer} #${orderNumber} ===`);
    console.log({ orderDate: order.orderDate, orderDateEstimated: order.orderDateEstimated, returnDeadline: order.returnDeadline, createdAt: order.createdAt, displayStatus: order.displayStatus });
    const emails = await prisma.email.findMany({ where: { orderId: order.id }, orderBy: { receivedAt: "asc" } });
    for (const e of emails) {
      const dec = decryptEmailContent(e as any);
      console.log({
        emailType: e.emailType,
        subject: dec.subject,
        receivedAt: e.receivedAt,
        extractedOrderDate: e.orderDate,
        anchorDate: e.anchorDate,
        anchorSource: e.anchorSource,
        forwardType: e.forwardType,
      });
    }
  }
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
const prisma = new PrismaClient();

async function main() {
  for (const orderNumber of ["M223726065", "SB33487073", "44266308515307"]) {
    const order = await prisma.order.findFirst({ where: { orderNumber } });
    if (!order) continue;
    console.log(`\n=== ${order.retailer} #${orderNumber} ===`);
    console.log({ orderDate: order.orderDate, returnDeadline: order.returnDeadline });
    const emails = await prisma.email.findMany({
      where: { orderId: order.id, emailType: "order_confirmation" },
      orderBy: { receivedAt: "asc" },
    });
    for (const e of emails) {
      const dec = decryptEmailContent(e as any);
      console.log({ subject: dec.subject, receivedAt: e.receivedAt, extractedOrderDate: e.orderDate, anchorDate: e.anchorDate });
    }
  }
}
main().finally(() => prisma.$disconnect());

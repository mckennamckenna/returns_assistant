import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
const prisma = new PrismaClient();

async function main() {
  const flagged = [
    { retailer: "MANGO", orderNumber: "F4VLSF" },
    { retailer: "Ruti", orderNumber: "424051" },
    { retailer: "Bettervits USA", orderNumber: "444466" },
    { retailer: "H&M", orderNumber: "66993117803" },
    { retailer: "Sidekick", orderNumber: "SK213978" },
    { retailer: "Tuckernuck", orderNumber: "TNK6875105" },
  ];

  for (const f of flagged) {
    const order = await prisma.order.findFirst({ where: { orderNumber: f.orderNumber } });
    if (!order) { console.log(`\n=== ${f.retailer} ${f.orderNumber} — ORDER NOT FOUND ===`); continue; }

    const emails = await prisma.email.findMany({
      where: { orderId: order.id },
      orderBy: { receivedAt: "asc" },
    });

    console.log(`\n=== ${order.retailer} #${order.orderNumber} (${emails.length} email${emails.length === 1 ? "" : "s"}) ===`);
    console.log("Order:", {
      id: order.id,
      userId: order.userId,
      orderDate: order.orderDate,
      orderDateEstimated: order.orderDateEstimated,
      orderDateSource: order.orderDateSource,
      returnDeadline: order.returnDeadline,
      returnWindowDays: order.returnWindowDays,
      returnWindowStartsFrom: order.returnWindowStartsFrom,
      displayStatus: order.displayStatus,
      needsReview: order.needsReview,
      createdAt: order.createdAt,
    });

    for (const e of emails) {
      const dec = decryptEmailContent(e as any);
      console.log({
        id: e.id,
        emailType: e.emailType,
        subject: dec.subject,
        fromEmail: dec.fromEmail,
        receivedAt: e.receivedAt,
        extractedAt: e.extractedAt,
        forwardType: e.forwardType,
        anchorDate: e.anchorDate,
        anchorSource: e.anchorSource,
        extractedOrderDate: e.orderDate,
        extractedDeliveryDate: e.deliveryDate,
        extractedEstimatedDeliveryDate: e.estimatedDeliveryDate,
        extractedDeliveredAt: e.deliveredAt,
        needsReview: e.needsReview,
        retailerSource: e.retailerSource,
      });
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

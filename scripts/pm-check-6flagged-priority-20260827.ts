import { PrismaClient } from "@prisma/client";
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
    if (!order) { console.log({ ...f, found: false }); continue; }
    const emails = await prisma.email.findMany({
      where: { orderId: order.id },
      select: { emailType: true, orderDate: true, anchorDate: true, anchorSource: true, receivedAt: true },
      orderBy: { receivedAt: "asc" },
    });
    const confirmation = emails.find((e) => e.emailType === "order_confirmation");
    let predictedRule = "none (residual)";
    let predictedOrderDate: Date | null = null;
    if (confirmation) {
      if (confirmation.orderDate != null) {
        predictedRule = "priority 1 (order_confirmation extracted orderDate)";
        predictedOrderDate = confirmation.orderDate;
      } else if (confirmation.anchorDate != null) {
        predictedRule = "priority 2 (order_confirmation anchorDate)";
        predictedOrderDate = confirmation.anchorDate;
      }
    }
    console.log({
      retailer: f.retailer,
      orderNumber: f.orderNumber,
      currentOrderDate: order.orderDate,
      hasOrderConfirmation: !!confirmation,
      confirmationExtractedOrderDate: confirmation?.orderDate ?? null,
      confirmationAnchorDate: confirmation?.anchorDate ?? null,
      confirmationAnchorSource: confirmation?.anchorSource ?? null,
      allEmailTypes: emails.map((e) => e.emailType),
      predictedRule,
      predictedOrderDate,
    });
  }
}
main().finally(() => prisma.$disconnect());

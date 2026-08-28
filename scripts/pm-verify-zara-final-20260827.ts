import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: "54421192781" } });
  console.log({
    orderDate: order?.orderDate,
    orderDateSource: order?.orderDateSource,
    orderDateEstimated: order?.orderDateEstimated,
    returnDeadline: order?.returnDeadline,
    deadlineIsEstimated: order?.deadlineIsEstimated,
    deliveredAt: order?.deliveredAt,
    estimatedDeliveryDate: order?.estimatedDeliveryDate,
  });
}
main().finally(() => prisma.$disconnect());

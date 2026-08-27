import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: ["54421192781", "5199902752", "1055864196"] } },
    select: { retailer: true, orderNumber: true, displayStatus: true, deliveredAt: true, estimatedDeliveryDate: true, returnDeadline: true },
  });
  console.log(orders);
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: "1058208405" } });
  console.log({ retailer: order?.retailer, orderNumber: order?.orderNumber, orderDate: order?.orderDate, orderDateSource: order?.orderDateSource, returnDeadline: order?.returnDeadline });
}
main().finally(() => prisma.$disconnect());

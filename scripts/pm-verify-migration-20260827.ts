import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: "54421192781" }, select: { orderDateSource: true, orderDate: true } });
  console.log(order);
  const count = await prisma.order.count({ where: { orderDateSource: "unknown" } });
  const total = await prisma.order.count();
  console.log(`orderDateSource='unknown': ${count} / ${total}`);
}
main().finally(() => prisma.$disconnect());

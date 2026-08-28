import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: "1058208405" } });
  console.log({
    orderDate: order?.orderDate,
    returnDeadline: order?.returnDeadline,
    returnWindowDays: order?.returnWindowDays,
    returnWindowStartsFrom: order?.returnWindowStartsFrom,
    deadlineIsEstimated: order?.deadlineIsEstimated,
    policySource: order?.policySource,
  });
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findUnique({ where: { id: "cmt9hs6yw0001l604vj8v8395" } });
  console.log("Order-level returnDeadline:", order?.returnDeadline, "deadlineIsEstimated:", order?.deadlineIsEstimated, "returnWindowDays:", order?.returnWindowDays, "returnWindowStartsFrom:", order?.returnWindowStartsFrom, "policySource:", order?.policySource, "orderDate:", order?.orderDate, "deliveredAt:", order?.deliveredAt, "estimatedDeliveryDate:", order?.estimatedDeliveryDate);

  const emails = await prisma.email.findMany({
    where: { orderId: order?.id },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true, emailType: true, receivedAt: true, extractedAt: true,
      orderDate: true, deliveredAt: true, deliveryDate: true, estimatedDeliveryDate: true,
      returnWindowDays: true, returnWindowStartsFrom: true, returnDeadline: true, deadlineIsEstimated: true, policySource: true,
    },
  });
  for (const e of emails) console.log(e);
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findFirst({ where: { orderNumber: "54421192781" } });
  const confirmation = await prisma.email.findFirst({
    where: { orderId: order?.id, emailType: "order_confirmation" },
    select: { returnDeadline: true, deadlineIsEstimated: true },
  });
  console.log("Email.returnDeadline (order_confirmation's frozen snapshot):", confirmation);
}
main().finally(() => prisma.$disconnect());

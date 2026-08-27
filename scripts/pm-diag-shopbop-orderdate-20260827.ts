import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const order = await prisma.order.findUnique({ where: { id: "cmsf4qmn30003kw04r6b0fyle" } });
  console.log("Order:", { id: order?.id, orderDate: order?.orderDate, createdAt: order?.createdAt, displayStatus: order?.displayStatus });
  const emails = await prisma.email.findMany({
    where: { orderId: order?.id },
    orderBy: { receivedAt: "asc" },
    select: { id: true, emailType: true, receivedAt: true, extractedAt: true, forwardType: true, anchorDate: true, orderDate: true, retailerSource: true },
  });
  for (const e of emails) console.log(e);
}
main().finally(() => prisma.$disconnect());

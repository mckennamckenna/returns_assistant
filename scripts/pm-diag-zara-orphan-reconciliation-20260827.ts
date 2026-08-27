import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const emails = await prisma.email.findMany({
    where: { orderId: "cmt9hs6yw0001l604vj8v8395" },
    select: { id: true, emailType: true, receivedAt: true, extractedAt: true, retailerSource: true, orderId: true, retailer: true, orderNumber: true },
    orderBy: { receivedAt: "asc" },
  });
  for (const e of emails) console.log(e);
}
main().finally(() => prisma.$disconnect());

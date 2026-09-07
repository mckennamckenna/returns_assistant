import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const bad = await prisma.order.findMany({
    where: { returnPortalUrl: { contains: "myreturnwindow.com" } },
    select: { id: true, retailer: true, updatedAt: true },
  });
  console.log("Orders currently with a self-domain returnPortalUrl:", bad.length);
  console.log(bad);
}
main().finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_ID = "cmr5dhodt0003jv04bq8oargl"; // Southbank Centre e-ticket, Bug 7

async function main() {
  const order = await prisma.order.findUnique({ where: { id: ORDER_ID } });
  if (!order) {
    console.log("Order not found — nothing to do.");
    return;
  }
  if (order.retailer !== "Southbank Centre") {
    console.log(`Refusing: retailer is "${order.retailer}", not "Southbank Centre". Aborting.`);
    return;
  }

  await prisma.order.update({
    where: { id: ORDER_ID },
    data: { deletedAt: new Date() },
  });
  console.log(`Soft-deleted order ${ORDER_ID} (${order.retailer}, ${order.orderNumber}).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

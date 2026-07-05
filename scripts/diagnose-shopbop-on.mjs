import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const onOrders = await prisma.order.findMany({
    where: { retailer: { contains: "on", mode: "insensitive" } },
    select: { id: true, retailer: true, orderNumber: true, orderTotal: true, lineItems: true, displayStatus: true, createdAt: true, userId: true },
  });
  console.log(`Orders with retailer containing "on" (${onOrders.length}):`);
  for (const o of onOrders) {
    console.log(`  ${o.id}  retailer="${o.retailer}"  #${o.orderNumber}  total=${o.orderTotal}  status=${o.displayStatus}  lineItems=${JSON.stringify(o.lineItems)}`);
  }

  console.log("\nAll emails mentioning 'Shopbop' anywhere (subject or retailer):");
  const shopbopEmails = await prisma.email.findMany({
    where: {
      OR: [
        { subject: { contains: "shopbop", mode: "insensitive" } },
        { retailer: { contains: "shopbop", mode: "insensitive" } },
      ],
    },
    select: { id: true, subject: true, retailer: true, emailType: true, orderNumber: true, orderId: true, orderTotal: true, receivedAt: true },
    orderBy: { receivedAt: "asc" },
  });
  for (const e of shopbopEmails) {
    console.log(`  ${e.id}  subject="${e.subject}"  retailer="${e.retailer}"  emailType=${e.emailType}  orderNumber=${e.orderNumber}  orderId=${e.orderId}  total=${e.orderTotal}  receivedAt=${e.receivedAt.toISOString()}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

// READ-ONLY. Checks orderDate/orderTotal for the two orders flagged in the
// 2026-08-14 coverage-check digest, scoped to mckenna.sweazey@gmail.com.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { email: "mckenna.sweazey@gmail.com" } });
  if (!user) return console.log("User not found.");
  const ids = ["cmrx0ebri0003jr04itjef17j", "cmsr633e00003l1049lnzyre9"];
  for (const id of ids) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) { console.log(`${id}: not found`); continue; }
    if (order.userId !== user.id) { console.log(`${id}: belongs to a different user, skipping`); continue; }
    console.log(JSON.stringify(order, null, 2));
  }
}
main().finally(() => prisma.$disconnect());

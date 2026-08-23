// READ-ONLY. Zero billed calls. Checks whether another Laundry Sauce
// email exists on the same account that might carry the order number
// cmt0uxvz70001ic0468kxgkjp itself lacks entirely.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ID = "cmt0uxvz70001ic0468kxgkjp";

async function main() {
  const target = await prisma.email.findUnique({ where: { id: ID }, select: { toHash: true, retailer: true, receivedAt: true } });
  if (!target) return console.log("not found");

  const siblings = await prisma.email.findMany({
    where: { toHash: target.toHash, retailer: "Laundry Sauce" },
    select: { id: true, emailType: true, subject: true, receivedAt: true, orderNumber: true, orderId: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log("Same-account Laundry Sauce emails:", siblings);
  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());

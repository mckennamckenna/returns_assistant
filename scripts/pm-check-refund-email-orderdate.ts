// READ-ONLY. Confirms whether the Suzie Kondi refund email's own extracted
// orderDate field is what overwrote the order's orderDate on merge.
// Scoped to mckenna.sweazey@gmail.com via userId check.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { email: "mckenna.sweazey@gmail.com" } });
  if (!user) return console.log("User not found.");
  const email = await prisma.email.findUnique({ where: { id: "cmsqp1ehg0001jp04gozjru35" } });
  if (!email || email.userId !== user.id) return console.log("Not found or ownership mismatch.");
  console.log({
    id: email.id,
    emailType: email.emailType,
    orderDate: email.orderDate,
    orderDateEstimated: email.orderDateEstimated,
    receivedAt: email.receivedAt,
  });
}
main().finally(() => prisma.$disconnect());

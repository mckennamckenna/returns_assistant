// READ-ONLY. Confirms whether the Suzie Kondi refund email's own extracted
// orderDate field is what overwrote the order's orderDate on merge.
// Scoped to the account set via PM_DIAG_USER_EMAIL, via userId check.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  if (!process.env.PM_DIAG_USER_EMAIL) {
    console.error("Set PM_DIAG_USER_EMAIL before running");
    process.exit(1);
  }
  if (!process.env.PM_DIAG_EMAIL_ID) {
    console.error("Set PM_DIAG_EMAIL_ID before running");
    process.exit(1);
  }
  const user = await prisma.user.findFirst({ where: { email: process.env.PM_DIAG_USER_EMAIL } });
  if (!user) return console.log("User not found.");
  const email = await prisma.email.findUnique({ where: { id: process.env.PM_DIAG_EMAIL_ID } });
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

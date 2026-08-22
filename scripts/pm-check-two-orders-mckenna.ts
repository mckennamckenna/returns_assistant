// READ-ONLY. Checks orderDate/orderTotal for the two orders flagged in the
// 2026-08-14 coverage-check digest, scoped to the account set via PM_DIAG_USER_EMAIL.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  if (!process.env.PM_DIAG_USER_EMAIL) {
    console.error("Set PM_DIAG_USER_EMAIL before running");
    process.exit(1);
  }
  if (!process.env.PM_DIAG_ORDER_ID_2) {
    console.error("Set PM_DIAG_ORDER_ID_2 before running (Suzie Kondi order)");
    process.exit(1);
  }
  if (!process.env.PM_DIAG_ORDER_ID) {
    console.error("Set PM_DIAG_ORDER_ID before running (the J.Crew orphan order)");
    process.exit(1);
  }
  const user = await prisma.user.findFirst({ where: { email: process.env.PM_DIAG_USER_EMAIL } });
  if (!user) return console.log("User not found.");
  // ids[0] = Suzie Kondi order, ids[1] = the J.Crew orphan order (shared value with
  // pm-diag-jcrew-duplicate-order-compare.ts / pm-verify-coverage-gate-live.ts).
  const ids = [process.env.PM_DIAG_ORDER_ID_2, process.env.PM_DIAG_ORDER_ID];
  for (const id of ids) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) { console.log(`${id}: not found`); continue; }
    if (order.userId !== user.id) { console.log(`${id}: belongs to a different user, skipping`); continue; }
    console.log(JSON.stringify(order, null, 2));
  }
}
main().finally(() => prisma.$disconnect());

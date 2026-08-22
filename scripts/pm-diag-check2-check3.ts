// READ-ONLY. 0 billed Anthropic calls, 0 writes. Two checks:
// 1) Full dump of the Bloomingdale's #779507885 SUSPICIOUS_AMBIGUOUS row.
// 2) Whether the Fitness Superstore #48868 CORRUPTED_RECOVERABLE row is
//    still open/returnable (deadline-visible) vs already closed out.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  if (!process.env.PM_DIAG_ORDER_ID) {
    console.error("Set PM_DIAG_ORDER_ID before running (Bloomingdale's order)");
    process.exit(1);
  }
  if (!process.env.PM_DIAG_ORDER_ID_2) {
    console.error("Set PM_DIAG_ORDER_ID_2 before running (Fitness Superstore order)");
    process.exit(1);
  }
  const bloomies = await prisma.order.findUnique({
    where: { id: process.env.PM_DIAG_ORDER_ID },
    include: { emails: true },
  });
  console.log("=== Bloomingdale's #779507885 (SUSPICIOUS_AMBIGUOUS) ===\n");
  if (!bloomies) {
    console.log("!! not found");
  } else {
    console.log({
      id: bloomies.id,
      retailer: bloomies.retailer,
      orderNumber: bloomies.orderNumber,
      orderDate: day(bloomies.orderDate),
      orderDateEstimated: bloomies.orderDateEstimated,
      status: bloomies.status,
      displayStatus: bloomies.displayStatus,
      returnDeadline: day(bloomies.returnDeadline),
      createdAt: day(bloomies.createdAt),
    });
    console.log("\nLinked emails:");
    for (const e of [...bloomies.emails].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
      console.log({
        type: e.emailType,
        extracted_orderDate: day(e.orderDate),
        receivedAt: day(e.receivedAt),
      });
    }
  }

  const fitness = await prisma.order.findUnique({
    where: { id: process.env.PM_DIAG_ORDER_ID_2 },
  });
  console.log("\n\n=== Fitness Superstore #48868 (CORRUPTED_RECOVERABLE) — open/returnable check ===\n");
  if (!fitness) {
    console.log("!! not found");
  } else {
    console.log({
      id: fitness.id,
      retailer: fitness.retailer,
      orderNumber: fitness.orderNumber,
      status: fitness.status,
      displayStatus: fitness.displayStatus,
      orderDate: day(fitness.orderDate),
      returnDeadline: day(fitness.returnDeadline),
      deadlineIsEstimated: fitness.deadlineIsEstimated,
      archivedAt: day(fitness.archivedAt),
      deletedAt: day(fitness.deletedAt),
      returnedAt: day(fitness.returnedAt),
      keptAt: day(fitness.keptAt),
      needsReview: fitness.needsReview,
    });
    const now = new Date();
    const stillOpen = fitness.status !== "completed" && fitness.status !== "expired" && !fitness.archivedAt && !fitness.deletedAt;
    console.log(`\n→ still-open returnable?: ${stillOpen ? "YES" : "NO"} (status=${fitness.status})`);
    if (fitness.returnDeadline) {
      console.log(`→ current stored returnDeadline vs now: ${fitness.returnDeadline > now ? "in the future" : "already past"}`);
    }
  }

  console.log("\n\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

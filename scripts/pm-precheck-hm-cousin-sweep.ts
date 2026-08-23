// READ-ONLY. Zero billed calls. Pre-code check for the H&M cousin sweep
// (TASKS.md, follow-up to the 2026-08-23 return_label fix). Re-runs
// yesterday's cousin census query verbatim, then filters out the 2 rows
// already re-extracted manually, and confirms those 2 actually landed.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALREADY_REEXTRACTED = [
  "cmt090ioq0001l404crsih7w9", // yesterday's diagnostic target
];

async function main() {
  const rows = await prisma.$queryRaw<
    { id: string; retailer: string | null; receivedAt: Date; orderNumber: string | null }[]
  >`
    SELECT id, retailer, "receivedAt", "orderNumber"
    FROM "Email"
    WHERE retailer IS NOT NULL
      AND "orderNumber" IS NULL
      AND "emailType" IN ('return_label', 'refund', 'shipping_confirmation')
      AND "textBody" IS NOT NULL
      AND "htmlBody" IS NOT NULL
      AND LENGTH("textBody") > 100
    ORDER BY "receivedAt" ASC
  `;

  console.log(`Cousin census count today: ${rows.length} (yesterday: 6)`);
  console.log(rows.map((r) => ({ id: r.id, retailer: r.retailer, receivedAt: r.receivedAt, orderNumber: r.orderNumber })));

  // Also find the return_label row for order 68468087873, re-extracted
  // via the UI today per the task brief — need its Email.id to exclude it
  // (it won't appear in the census above since its orderNumber should now
  // be non-null, but confirm explicitly and check the value stuck).
  const order = await prisma.order.findFirst({
    where: { orderNumber: "68468087873" },
    include: { emails: { select: { id: true, emailType: true, orderNumber: true, orderId: true, needsReview: true } } },
  });
  console.log("\nOrder 68468087873 linked emails:", order?.emails);

  console.log("\n=== Confirm the 2 known already-re-extracted rows landed ===");
  for (const id of ALREADY_REEXTRACTED) {
    const e = await prisma.email.findUnique({ where: { id }, select: { id: true, orderNumber: true, orderId: true } });
    console.log(id, e);
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());

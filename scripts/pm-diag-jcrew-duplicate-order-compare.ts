// READ-ONLY. 0 billed Anthropic calls, 0 writes (findFirst/findUnique only).
// Full Order + linked-email dump for J.Crew #2523415500 (the digest
// offender, orphaned refund-only order), plus a shared-identifier
// comparison against #2522877374 (the healthy original) — what a matcher
// could plausibly have used to rejoin them. Ownership-scoped to
// the account set via PM_DIAG_USER_EMAIL via userId check on both rows before printing.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();
if (!process.env.PM_DIAG_USER_EMAIL) {
  console.error("Set PM_DIAG_USER_EMAIL before running");
  process.exit(1);
}
if (!process.env.PM_DIAG_ORDER_ID) {
  console.error("Set PM_DIAG_ORDER_ID before running (the orphan order)");
  process.exit(1);
}
if (!process.env.PM_DIAG_ORDER_ID_2) {
  console.error("Set PM_DIAG_ORDER_ID_2 before running (the original order)");
  process.exit(1);
}
const OWNER_EMAIL: string = process.env.PM_DIAG_USER_EMAIL;
const ORPHAN_ORDER_ID: string = process.env.PM_DIAG_ORDER_ID;
const ORIGINAL_ORDER_ID: string = process.env.PM_DIAG_ORDER_ID_2;

async function main() {
  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
  if (!owner) return console.log("Owner not found.");

  const orphan = await prisma.order.findUnique({
    where: { id: ORPHAN_ORDER_ID },
    include: { emails: true },
  });
  const original = await prisma.order.findUnique({
    where: { id: ORIGINAL_ORDER_ID },
    include: { emails: true },
  });

  if (!orphan || orphan.userId !== owner.id) return console.log("Orphan order not found or ownership mismatch.");
  if (!original || original.userId !== owner.id) return console.log("Original order not found or ownership mismatch.");

  console.log("=== Part A — full dump: #2523415500 (orphan) ===\n");
  console.log({
    id: orphan.id,
    retailer: orphan.retailer,
    orderNumber: orphan.orderNumber,
    orderTotal: orphan.orderTotal,
    orderCurrency: orphan.orderCurrency,
    orderDate: orphan.orderDate,
    orderDateEstimated: orphan.orderDateEstimated,
    createdAt: orphan.createdAt,
    updatedAt: orphan.updatedAt,
    status: orphan.status,
    displayStatus: orphan.displayStatus,
    needsReview: orphan.needsReview,
    returnDeadline: orphan.returnDeadline,
    deadlineIsEstimated: orphan.deadlineIsEstimated,
    policySource: orphan.policySource,
    returnWindowDays: orphan.returnWindowDays,
    returnWindowStartsFrom: orphan.returnWindowStartsFrom,
    returnPortalUrl: orphan.returnPortalUrl,
    archivedAt: orphan.archivedAt,
    deletedAt: orphan.deletedAt,
    returnedAt: orphan.returnedAt,
    keptAt: orphan.keptAt,
  });

  console.log("\nLinked emails:");
  for (const e of orphan.emails) {
    console.log({
      id: e.id,
      type: e.emailType,
      extracted_orderDate: e.orderDate,
      receivedAt: e.receivedAt,
      subject: e.subject,
      orderNumber: e.orderNumber,
    });
  }

  console.log("\n\n=== Shared-identifier comparison: #2523415500 (orphan) vs #2522877374 (original) ===\n");

  const orphanEmails = orphan.emails.map((e) => ({
    fromEmail: e.fromEmail ? decrypt(e.fromEmail) : null,
    amount: e.orderTotal ?? e.refundAmount,
    lineItems: e.lineItems,
    subject: e.subject,
    orderNumber: e.orderNumber,
  }));
  const originalEmails = original.emails.map((e) => ({
    fromEmail: e.fromEmail ? decrypt(e.fromEmail) : null,
    amount: e.orderTotal,
    lineItems: e.lineItems,
    subject: e.subject,
    orderNumber: e.orderNumber,
  }));

  console.log("Orphan (#2523415500) email fromEmail addresses:", [...new Set(orphanEmails.map((e) => e.fromEmail))]);
  console.log("Original (#2522877374) email fromEmail addresses:", [...new Set(originalEmails.map((e) => e.fromEmail))]);

  console.log("\nOrphan orderTotal/refund amount(s):", orphanEmails.map((e) => e.amount));
  console.log("Original orderTotal (order-level):", original.orderTotal, " | per-email:", originalEmails.map((e) => e.amount));

  console.log("\nOrphan line items (order-level):", JSON.stringify(orphan.lineItems));
  console.log("Original line items (order-level):", JSON.stringify(original.lineItems));

  console.log("\nOrphan subjects:", orphanEmails.map((e) => e.subject));
  console.log("Original subjects:", originalEmails.map((e) => e.subject));

  console.log("\nOrphan orderNumber(s) seen on its own linked emails:", orphanEmails.map((e) => e.orderNumber));
  console.log("Original orderNumber(s) seen on its own linked emails:", originalEmails.map((e) => e.orderNumber));

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

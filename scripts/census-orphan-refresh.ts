// Orphan census refresh (TASKS.md, 2026-08-04). READ-ONLY — no writes, no
// Anthropic calls. Does not import runExtraction/extractEmail, by design,
// so this script cannot accidentally bill anything.
//
// Refreshes the four no-resolve-path population counts first sized
// 2026-07-23 (HISTORY.md "Needs Review four-slot inventory"):
//   - orphaned genuine-commerce (orderId: null, emailType set, not "other")
//   - extraction failures (emailType: null) — split ran-and-failed vs never-ran
//   - linked-but-flagged (Email.needsReview: true, orderId not null)
//   - junked (junkedAt not null)
//
// Usage: npx tsx scripts/census-orphan-refresh.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("ORPHAN CENSUS REFRESH — READ ONLY. Zero writes, zero Anthropic calls.\n");

  // --- Orphaned genuine-commerce: linked to nothing, but a real commerce
  // email (not "other" — those are the confirmed-safe junk population).
  const orphanedCommerce = await prisma.email.findMany({
    where: {
      orderId: null,
      emailType: { not: null, notIn: ["other"] },
      junkedAt: null,
    },
    select: {
      id: true,
      userId: true,
      receivedAt: true,
      emailType: true,
      retailer: true,
      orderNumber: true,
      subject: true,
      needsReview: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  // --- Extraction failures: emailType still null.
  const ranAndFailed = await prisma.email.count({
    where: { emailType: null, extractedAt: { not: null } },
  });
  const neverRan = await prisma.email.count({
    where: { emailType: null, extractedAt: null },
  });

  // --- Linked-but-flagged: has an order, but Email.needsReview is true
  // with no resolve path (rescueEmail has zero call sites; this is a
  // distinct population from the orphan needsReview flags).
  const linkedButFlagged = await prisma.email.count({
    where: { orderId: { not: null }, needsReview: true },
  });

  // --- Junked.
  const junked = await prisma.email.count({
    where: { junkedAt: { not: null } },
  });

  const totalEmails = await prisma.email.count();

  console.log("=== HEADLINE COUNTS (vs. 2026-07-23) ===");
  console.log(`Orphaned genuine-commerce: ${orphanedCommerce.length} (was 20)`);
  console.log(`Extraction failures (emailType: null): ${ranAndFailed + neverRan} (was 35)`);
  console.log(`  ran-and-failed: ${ranAndFailed} (was 23)`);
  console.log(`  never-ran: ${neverRan} (was 12)`);
  console.log(`Linked-but-flagged (needsReview, has order): ${linkedButFlagged} (was 108)`);
  console.log(`Junked: ${junked} (was 174)`);
  const total = orphanedCommerce.length + ranAndFailed + neverRan + linkedButFlagged + junked;
  console.log(`TOTAL zero-resolve-action population: ${total} (was ~337)`);
  console.log(`(For scale: ${totalEmails} total Email rows currently.)\n`);

  console.log("=== ORPHANED GENUINE-COMMERCE DETAIL ===");
  for (const e of orphanedCommerce) {
    console.log(
      `${e.id} | user=${e.userId} | ${e.receivedAt.toISOString()} | type=${e.emailType} | retailer=${e.retailer ?? "null"} | orderNumber=${e.orderNumber ?? "null"} | needsReview=${e.needsReview}`,
    );
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

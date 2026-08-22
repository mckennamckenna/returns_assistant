// Amazon return-window forward short-circuit — Step 0 census.
// READ-ONLY — no writes, no Anthropic calls.
// Usage: npx tsx scripts/census-amazon-lookup-volume.ts
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "../lib/amazonBundle";

const prisma = new PrismaClient();

async function main() {
  console.log("=== 0.1 — isAmazonOrder ===");
  console.log(isAmazonOrder.toString());

  console.log("\n=== 0.2 — HEADLINE: forward lookup volume ===");

  // EMAIL level — the actual call granularity: lookupReturnPolicy() fires
  // once per qualifying EMAIL during extraction, not once per Order.
  const allEmails = await prisma.email.findMany({
    select: { id: true, retailer: true, returnWindowDays: true, policySource: true, emailType: true, orderId: true },
  });
  const amazonEmails = allEmails.filter((e) => isAmazonOrder(e.retailer));
  const amazonEmailsLookedUp = amazonEmails.filter((e) => e.policySource === "web_lookup");
  const amazonEmailsNullWindowNow = amazonEmails.filter((e) => e.returnWindowDays == null && e.emailType !== "other");
  console.log(`Total Email rows: ${allEmails.length}`);
  console.log(`Amazon-retailer Email rows: ${amazonEmails.length}`);
  console.log(`  -> policySource: "web_lookup" (historical, confirmed lookup fired): ${amazonEmailsLookedUp.length}`);
  console.log(`  -> returnWindowDays still null today, emailType != other (would re-fire if reprocessed): ${amazonEmailsNullWindowNow.length}`);

  // ORDER level — the proxy the prompt suggests as a lower bound.
  const allOrders = await prisma.order.findMany({
    select: { id: true, retailer: true, returnWindowDays: true, policySource: true, needsReview: true },
  });
  const amazonOrders = allOrders.filter((o) => isAmazonOrder(o.retailer));
  const amazonOrdersLookedUp = amazonOrders.filter((o) => o.policySource === "web_lookup");
  const amazonOrdersNullWindow = amazonOrders.filter((o) => o.returnWindowDays == null);
  console.log(`\nTotal Order rows: ${allOrders.length}`);
  console.log(`Amazon-retailer Order rows: ${amazonOrders.length}`);
  console.log(`  -> policySource: "web_lookup" (order-level proxy): ${amazonOrdersLookedUp.length}`);
  console.log(`  -> returnWindowDays: null (order-level forward-eligible proxy): ${amazonOrdersNullWindow.length}`);

  console.log("\n=== 0.3 — flagged-backfill set (minor) ===");
  const flaggedAmazon = amazonOrders.filter((o) => o.needsReview);
  const guardA = flaggedAmazon.filter((o) => o.returnWindowDays == null);
  const guardB = flaggedAmazon.filter((o) => o.returnWindowDays != null);
  console.log(`Amazon orders with needsReview=true: ${flaggedAmazon.length}`);
  console.log(`  (a) returnWindowDays null -> eligible for default+flag-clear: ${guardA.length}`);
  guardA.forEach((o) => console.log(`      id=${o.id} returnWindowDays=${o.returnWindowDays} policySource=${o.policySource}`));
  console.log(`  (b) already has a window, flagged for another reason -> GUARD, do not touch: ${guardB.length}`);
  guardB.forEach((o) => console.log(`      id=${o.id} returnWindowDays=${o.returnWindowDays} policySource=${o.policySource}`));

  console.log("\n=== 0.4 — format-break check on the null-window Amazon Order population ===");
  const nullWindowOrdersFull = await prisma.order.findMany({
    where: { id: { in: amazonOrdersNullWindow.map((o) => o.id) } },
    include: { emails: { select: { subject: true, orderNumber: true, extractionNotes: true } } },
  });
  const formatBreak = nullWindowOrdersFull.filter((o) => {
    const allBlank = o.retailer == null && o.orderNumber == null && o.orderDate == null && o.orderTotal == null;
    const distinctOrderNumbers = new Set(o.emails.map((e) => e.orderNumber).filter((n): n is string => n != null));
    const multiOrderNote = o.emails.some((e) => /multiple order|order numbers?/i.test(e.extractionNotes ?? ""));
    return allBlank || distinctOrderNumbers.size > 1 || multiOrderNote;
  });
  console.log(`Null-window Amazon orders total: ${nullWindowOrdersFull.length}`);
  console.log(`Look like a broken parse (held aside, NOT defaulted): ${formatBreak.length}`);
  formatBreak.forEach((o) => console.log(`  id=${o.id} retailer=${o.retailer} orderNumber=${o.orderNumber} subjects=${o.emails.map((e) => e.subject).join(" | ")}`));
  const cleanNullWindow = nullWindowOrdersFull.filter((o) => !formatBreak.includes(o));
  console.log(`Clean null-window Amazon orders (dry-run Step-2 candidates): ${cleanNullWindow.length}`);
  cleanNullWindow.forEach((o) =>
    console.log(
      `  id=${o.id} retailer=${o.retailer} orderNumber=${o.orderNumber ?? "null"} orderDate=${o.orderDate?.toISOString() ?? "null"} orderTotal=${o.orderTotal ?? "null"} needsReview=${o.needsReview} subjects=${o.emails.map((e) => e.subject).join(" | ")}`,
    ),
  );

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

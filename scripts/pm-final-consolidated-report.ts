// READ-ONLY. 0 billed Anthropic calls, 0 writes (findMany/count only).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const now = new Date().toISOString();
  console.log(`CONSOLIDATED SNAPSHOT — ${now} — READ ONLY, zero writes, zero Anthropic calls\n`);

  // STEP 1
  const total = await prisma.email.count({ where: { needsReview: true } });
  const linkedRows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: {
      id: true, orderId: true, retailer: true, orderNumber: true, confidence: true,
      emailType: true, returnDeadline: true, orderDate: true, extractionNotes: true,
    },
  });
  const orphaned = await prisma.email.count({ where: { needsReview: true, orderId: null, junkedAt: null } });
  const junked = await prisma.email.count({ where: { needsReview: true, junkedAt: { not: null } } });

  console.log("=== STEP 1 ===");
  console.log(`total: ${total}, linked(a): ${linkedRows.length}, orphaned(b): ${orphaned}, junked(c): ${junked}`);
  console.log(`sum: ${linkedRows.length + orphaned + junked} vs total ${total} -> ${linkedRows.length + orphaned + junked === total ? "MATCH" : "MISMATCH"}\n`);

  // STEP 4
  const orderIds = [...new Set(linkedRows.map((r) => r.orderId!))];
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, needsReview: true } });
  const orderMap = new Map(orders.map((o) => [o.id, o.needsReview]));
  const both = linkedRows.filter((r) => orderMap.get(r.orderId!) === true).length;
  const emailOnly = linkedRows.filter((r) => orderMap.get(r.orderId!) !== true).length;
  console.log("=== STEP 4 ===");
  console.log(`distinct orders: ${orderIds.length}, both-flagged: ${both}, email-only-flagged: ${emailOnly}\n`);

  // STEP 3 clustering (same logic as before) on THIS snapshot
  const tieredRe = /multiple return windows detected/i;
  const unclearRe = /Web lookup for return policy was unclear/i;
  const finalSaleRe = /final sale/i;

  type Row = (typeof linkedRows)[number];
  const buckets: Record<string, Row[]> = {
    "low-confidence": [], "commerce-missing-retailer-or-ordernum": [],
    "tiered-window": [], "web-lookup-unclear-non-tiered": [],
    "order-confirmation-no-deadline-other": [], "other-unclassified": [],
  };
  for (const r of linkedRows) {
    const notes = r.extractionNotes ?? "";
    if (r.confidence === "low") { buckets["low-confidence"].push(r); continue; }
    if (r.emailType !== "other" && (!r.retailer || !r.orderNumber)) { buckets["commerce-missing-retailer-or-ordernum"].push(r); continue; }
    if (tieredRe.test(notes)) { buckets["tiered-window"].push(r); continue; }
    if (unclearRe.test(notes)) { buckets["web-lookup-unclear-non-tiered"].push(r); continue; }
    if (r.emailType === "order_confirmation" && !r.returnDeadline) { buckets["order-confirmation-no-deadline-other"].push(r); continue; }
    buckets["other-unclassified"].push(r);
  }
  console.log("=== STEP 3 (mutually exclusive, priority order) ===");
  let sum = 0;
  for (const [k, v] of Object.entries(buckets)) { console.log(`  ${k}: ${v.length}`); sum += v.length; }
  console.log(`sum: ${sum} vs bucket(a) ${linkedRows.length}\n`);

  // sub-cluster other-unclassified by final-sale-conflict signal
  const finalSaleConflict = buckets["other-unclassified"].filter(r => finalSaleRe.test(r.extractionNotes ?? ""));
  console.log(`  of which "other-unclassified" rows mentioning final-sale/exclusion conflict: ${finalSaleConflict.length}`);
  console.log(`  of which "other-unclassified" remainder (genuinely misc): ${buckets["other-unclassified"].length - finalSaleConflict.length}`);

  // multi-order-number-in-one-email, within low-confidence
  const multiOrderRe = /(two|three|multiple|2|3) (distinct |separate )?orders?/i;
  const multiOrder = buckets["low-confidence"].filter(r => multiOrderRe.test(r.extractionNotes ?? "") && r.retailer === "Amazon");
  console.log(`\n  of which "low-confidence" rows are Amazon emails bundling >1 distinct order number: ${multiOrder.length}`);

  // retailer concentration within tiered-window
  const byRetailer = new Map<string, number>();
  for (const r of buckets["tiered-window"]) {
    const k = r.retailer ?? "null";
    byRetailer.set(k, (byRetailer.get(k) ?? 0) + 1);
  }
  console.log(`\n  tiered-window: Amazon share = ${byRetailer.get("Amazon") ?? 0} / ${buckets["tiered-window"].length}`);

  // commerce-missing-retailer-or-ordernum: confirm all are refund-type
  const refundTypeCount = buckets["commerce-missing-retailer-or-ordernum"].filter(r => r.emailType === "refund").length;
  console.log(`  commerce-missing-retailer-or-ordernum: emailType===refund count = ${refundTypeCount} / ${buckets["commerce-missing-retailer-or-ordernum"].length}`);

  // order-confirmation-no-deadline-other: confirm all/most have orderDate null
  const noOrderDate = buckets["order-confirmation-no-deadline-other"].filter(r => !r.orderDate).length;
  console.log(`  order-confirmation-no-deadline-other: orderDate===null count = ${noOrderDate} / ${buckets["order-confirmation-no-deadline-other"].length}`);
}
main().finally(() => prisma.$disconnect());

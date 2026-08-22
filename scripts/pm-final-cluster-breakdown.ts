// READ-ONLY. 0 billed Anthropic calls, 0 writes (findMany only).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: {
      id: true, orderId: true, retailer: true, orderNumber: true, confidence: true,
      emailType: true, returnDeadline: true, orderDate: true, extractionNotes: true,
    },
  });

  const tieredRe = /multiple return windows detected/i;
  const unclearRe = /Web lookup for return policy was unclear/i;

  type Row = (typeof rows)[number];
  type Bucket = { key: string; rows: Row[] };
  const buckets: Bucket[] = [
    { key: "low-confidence", rows: [] },
    { key: "commerce-missing-retailer-or-ordernum", rows: [] },
    { key: "tiered-window (retailer policy has category/date tiers, via web lookup)", rows: [] },
    { key: "web-lookup-unclear-non-tiered", rows: [] },
    { key: "order-confirmation-no-deadline (other cause)", rows: [] },
    { key: "other-unclassified", rows: [] },
  ];

  for (const r of rows) {
    const notes = r.extractionNotes ?? "";
    if (r.confidence === "low") { buckets[0].rows.push(r); continue; }
    if (r.emailType !== "other" && (!r.retailer || !r.orderNumber)) { buckets[1].rows.push(r); continue; }
    if (tieredRe.test(notes)) { buckets[2].rows.push(r); continue; }
    if (unclearRe.test(notes)) { buckets[3].rows.push(r); continue; }
    if (r.emailType === "order_confirmation" && !r.returnDeadline) { buckets[4].rows.push(r); continue; }
    buckets[5].rows.push(r);
  }

  console.log(`total bucket (a) rows: ${rows.length}`);
  let sum = 0;
  for (const b of buckets) {
    console.log(`  ${b.key}: ${b.rows.length}`);
    sum += b.rows.length;
  }
  console.log(`sum: ${sum} (should equal ${rows.length})`);

  console.log("\n--- other-unclassified samples (all, since likely small) ---");
  for (const r of buckets[5].rows) {
    console.log(`\nid=${r.id} retailer=${r.retailer} emailType=${r.emailType} confidence=${r.confidence} returnDeadline=${r.returnDeadline}`);
    console.log(`  notes: ${r.extractionNotes}`);
  }

  console.log("\n--- order-confirmation-no-deadline (other cause) samples (up to 10) ---");
  for (const r of buckets[4].rows.slice(0, 10)) {
    console.log(`\nid=${r.id} retailer=${r.retailer} orderDate=${r.orderDate}`);
    console.log(`  notes: ${r.extractionNotes}`);
  }

  console.log("\n--- commerce-missing-retailer-or-ordernum samples (all, small) ---");
  for (const r of buckets[1].rows) {
    console.log(`\nid=${r.id} retailer=${r.retailer} orderNumber=${r.orderNumber} emailType=${r.emailType}`);
    console.log(`  notes: ${r.extractionNotes?.slice(0, 200)}`);
  }

  console.log("\n--- low-confidence samples (all, small) ---");
  for (const r of buckets[0].rows) {
    console.log(`\nid=${r.id} retailer=${r.retailer} emailType=${r.emailType}`);
    console.log(`  notes: ${r.extractionNotes?.slice(0, 250)}`);
  }
}
main().finally(() => prisma.$disconnect());

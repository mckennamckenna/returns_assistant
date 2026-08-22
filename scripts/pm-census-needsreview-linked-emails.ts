// PM investigation (2026-08-08): re-derive the 2026-07-23 "~108 linked
// needsReview emails with no resolve path" count and characterize what
// they actually need. READ-ONLY — no writes, no Anthropic calls, no
// re-extraction. Does not import runExtraction/extractEmail.
//
// Usage: npx tsx scripts/pm-census-needsreview-linked-emails.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("NEEDS-REVIEW LINKED-EMAIL CENSUS — READ ONLY. Zero writes, zero Anthropic calls.\n");

  // --- Step 1: split the whole needsReview population into 3 disjoint buckets ---
  const total = await prisma.email.count({ where: { needsReview: true } });
  const linked = await prisma.email.count({ where: { needsReview: true, orderId: { not: null } } });
  const orphaned = await prisma.email.count({ where: { needsReview: true, orderId: null, junkedAt: null } });
  const junked = await prisma.email.count({ where: { needsReview: true, junkedAt: { not: null } } });
  // sanity check: does any row have BOTH orderId set and junkedAt set? (should be 0 per lib/junk.ts's stated invariant)
  const linkedAndJunked = await prisma.email.count({
    where: { needsReview: true, orderId: { not: null }, junkedAt: { not: null } },
  });

  console.log("=== STEP 1: BUCKET SPLIT ===");
  console.log(`Total Email rows with needsReview=true: ${total}`);
  console.log(`(a) linked (orderId not null): ${linked}`);
  console.log(`(b) orphaned (orderId null, junkedAt null): ${orphaned}`);
  console.log(`(c) junked (junkedAt not null): ${junked}`);
  console.log(`sum(a,b,c) = ${linked + orphaned + junked} vs total = ${total} -> ${linked + orphaned + junked === total ? "MATCH" : "MISMATCH"}`);
  console.log(`rows with BOTH orderId set AND junkedAt set (should be 0): ${linkedAndJunked}\n`);

  // --- Step 2: is there a stored reason on bucket (a) rows? ---
  const linkedRows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: {
      id: true,
      orderId: true,
      retailer: true,
      orderNumber: true,
      orderDate: true,
      returnDeadline: true,
      confidence: true,
      emailType: true,
      extractionNotes: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const withNotes = linkedRows.filter((r) => r.extractionNotes && r.extractionNotes.trim().length > 0);
  console.log("=== STEP 2: STORED REASON ON BUCKET (a) ===");
  console.log(`bucket (a) rows: ${linkedRows.length}`);
  console.log(`rows with non-empty extractionNotes: ${withNotes.length}`);
  console.log(`rows with NULL/empty extractionNotes: ${linkedRows.length - withNotes.length}`);
  console.log(`(No dedicated "reason"/"reviewReason" column exists on Email in prisma/schema.prisma — confirmed by reading the schema directly.)\n`);

  // --- Step 4: email-level vs order-level flag overlap ---
  const orderIds = [...new Set(linkedRows.map((r) => r.orderId!))];
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, needsReview: true },
  });
  const orderNeedsReviewMap = new Map(orders.map((o) => [o.id, o.needsReview]));
  const emailOnlyFlagged = linkedRows.filter((r) => orderNeedsReviewMap.get(r.orderId!) !== true);
  const bothFlagged = linkedRows.filter((r) => orderNeedsReviewMap.get(r.orderId!) === true);

  console.log("=== STEP 4: EMAIL-LEVEL VS ORDER-LEVEL FLAG OVERLAP ===");
  console.log(`distinct orders touched by bucket (a): ${orderIds.length}`);
  console.log(`bucket (a) rows where linked Order.needsReview === true (both flagged): ${bothFlagged.length}`);
  console.log(`bucket (a) rows where linked Order.needsReview === false (email-flagged only): ${emailOnlyFlagged.length}\n`);

  // --- Step 3: cluster bucket (a) by actual reason, derived from extract.ts's real NEEDS REVIEW criteria ---
  // Criteria per lib/extract.ts NEEDS REVIEW block:
  //   1. tiered return window resolved (detectable via extractionNotes text)
  //   2. confidence === "low"
  //   3. commerce email (emailType != "other") but retailer or orderNumber undetermined
  //   4. emailType === "order_confirmation" and no returnDeadline
  //   5. other ambiguity flagged in notes (catch-all)
  type Row = (typeof linkedRows)[number];
  const tieredWindowRe = /multiple return windows detected/i;

  function classify(r: Row): string[] {
    const tags: string[] = [];
    if (r.extractionNotes && tieredWindowRe.test(r.extractionNotes)) tags.push("tiered-window");
    if (r.confidence === "low") tags.push("low-confidence");
    if (r.emailType && r.emailType !== "other" && (!r.retailer || !r.orderNumber)) tags.push("commerce-missing-retailer-or-ordernum");
    if (r.emailType === "order_confirmation" && !r.returnDeadline) tags.push("order-confirmation-no-deadline");
    if (tags.length === 0) tags.push("other-unclassified");
    return tags;
  }

  const clusterCounts = new Map<string, number>();
  const unclassified: Row[] = [];
  for (const r of linkedRows) {
    const tags = classify(r);
    if (tags.includes("other-unclassified")) unclassified.push(r);
    for (const t of tags) clusterCounts.set(t, (clusterCounts.get(t) ?? 0) + 1);
  }

  console.log("=== STEP 3: CLUSTERS (rule-based on extract.ts's own NEEDS REVIEW criteria, full bucket (a), NOT a sample) ===");
  console.log("(a single row can match >1 tag, so tag counts can sum to more than bucket size)");
  for (const [tag, count] of [...clusterCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tag}: ${count}`);
  }
  console.log(`\nrows matching NONE of the 4 known extract.ts criteria (other-unclassified): ${unclassified.length}`);

  console.log("\n--- sample of other-unclassified rows (up to 15), for manual read ---");
  for (const r of unclassified.slice(0, 15)) {
    console.log(`\nid=${r.id} orderId=${r.orderId}`);
    console.log(`  emailType=${r.emailType ?? "null"} confidence=${r.confidence ?? "null"} retailer=${r.retailer ?? "null"} orderNumber=${r.orderNumber ?? "null"}`);
    console.log(`  orderDate=${r.orderDate ? r.orderDate.toISOString() : "null"} returnDeadline=${r.returnDeadline ? r.returnDeadline.toISOString() : "null"}`);
    console.log(`  extractionNotes: ${r.extractionNotes ?? "(none)"}`);
  }

  console.log("\n--- full breakdown: emailType distribution within bucket (a) ---");
  const emailTypeCounts = new Map<string, number>();
  for (const r of linkedRows) {
    const key = r.emailType ?? "null";
    emailTypeCounts.set(key, (emailTypeCounts.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...emailTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

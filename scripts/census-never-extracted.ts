// Never-extracted (extractedAt: null) census, ALL senders — follow-up to
// census-amazon-blank-extraction.ts (TASKS.md, 2026-08-06). READ-ONLY — no
// writes, no Anthropic calls. Does not import runExtraction/extractEmail.
//
// Separates genuinely-singleton never-ran rows from same-subject/
// same-receivedAt duplicate-delivery clusters (the ACE VISALIA/GLOBAL-E
// redelivery shape), and reports Amazon vs non-Amazon so scope is explicit.
//
// Usage: npx tsx scripts/census-never-extracted.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("NEVER-EXTRACTED CENSUS (ALL SENDERS) — READ ONLY. Zero writes, zero Anthropic calls.\n");

  const neverRan = await prisma.email.findMany({
    where: { extractedAt: null },
    select: {
      id: true,
      userId: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      receivedAt: true,
      emailType: true,
      needsReview: true,
      orderId: true,
      messageId: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const totalEmails = await prisma.email.count();
  console.log(`Total Email rows: ${totalEmails}`);
  console.log(`extractedAt: null rows: ${neverRan.length}\n`);

  // Cluster by (userId, subject, receivedAt-to-the-second) to find
  // same-content redelivery duplicates vs genuine singletons.
  const clusterKey = (e: (typeof neverRan)[number]) => `${e.userId}|${e.subject ?? ""}|${e.receivedAt.toISOString()}`;
  const clusters = new Map<string, typeof neverRan>();
  for (const e of neverRan) {
    const key = clusterKey(e);
    const arr = clusters.get(key) ?? [];
    arr.push(e);
    clusters.set(key, arr);
  }

  const dupClusters = [...clusters.values()].filter((arr) => arr.length > 1);
  const singletons = [...clusters.values()].filter((arr) => arr.length === 1).map((arr) => arr[0]);

  const dupRowCount = dupClusters.reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Duplicate-delivery clusters (same user+subject+receivedAt, >1 row): ${dupClusters.length} clusters, ${dupRowCount} rows total`);
  console.log(`Genuine singleton never-ran rows: ${singletons.length}\n`);

  function decryptSender(e: { fromEmail: string; fromName: string | null }): string {
    try {
      const email = decrypt(e.fromEmail);
      const name = e.fromName ? decrypt(e.fromName) : null;
      return name ? `${email} (${name})` : email;
    } catch {
      return "[decrypt-failed]";
    }
  }

  console.log("=== DUPLICATE-DELIVERY CLUSTERS ===");
  for (const arr of dupClusters) {
    const first = arr[0];
    console.log(`\n[${arr.length}x] "${first.subject ?? "(no subject)"}" @ ${first.receivedAt.toISOString()}`);
    console.log(`  from: ${decryptSender(first)}`);
    console.log(`  emailType: ${first.emailType ?? "null"} | needsReview: ${first.needsReview} | orderId: ${first.orderId ?? "null"}`);
    console.log(`  row ids: ${arr.map((e) => e.id).join(", ")}`);
    console.log(`  messageIds: ${arr.map((e) => e.messageId ?? "null").join(", ")}`);
  }

  console.log("\n\n=== GENUINE SINGLETON NEVER-RAN ROWS ===");
  let amazonCount = 0;
  for (const e of singletons) {
    const sender = decryptSender(e);
    const isAmazon = sender.toLowerCase().includes("amazon") || (e.subject ?? "").toLowerCase().includes("amazon");
    if (isAmazon) amazonCount++;
    console.log(`\n${e.id}${isAmazon ? " [AMAZON]" : ""}`);
    console.log(`  from: ${sender}`);
    console.log(`  subject: ${e.subject ?? "(no subject)"}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
    console.log(`  emailType: ${e.emailType ?? "null"} | needsReview: ${e.needsReview} | orderId: ${e.orderId ?? "null"}`);
  }

  console.log(`\n\n=== SCOPE SUMMARY ===`);
  console.log(`Singleton never-ran rows: ${singletons.length} total, ${amazonCount} Amazon-sender, ${singletons.length - amazonCount} non-Amazon`);
  console.log(`Duplicate-cluster never-ran rows: ${dupRowCount} total, in ${dupClusters.length} clusters`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

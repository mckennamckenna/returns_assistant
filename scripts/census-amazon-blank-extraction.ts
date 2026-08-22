// Amazon "extracts to all-blank" repro check (TASKS.md 🐛 Trust-breaking,
// "Amazon order-confirmation emails extract to ALL BLANK"). READ-ONLY — no
// writes, no Anthropic calls. Does not import runExtraction/extractEmail.
//
// fromEmail/fromName are encrypted at rest (lib/crypto.ts) so the
// Amazon-sender match happens in JS after decrypting, not at the DB level.
// subject is plaintext, matched directly.
//
// Usage: npx tsx scripts/census-amazon-blank-extraction.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();

function isAmazonSender(fromEmailDecrypted: string, fromNameDecrypted: string | null, subject: string | null): boolean {
  const hay = `${fromEmailDecrypted} ${fromNameDecrypted ?? ""} ${subject ?? ""}`.toLowerCase();
  return hay.includes("amazon");
}

async function main() {
  console.log("AMAZON BLANK-EXTRACTION CENSUS — READ ONLY. Zero writes, zero Anthropic calls.\n");

  const all = await prisma.email.findMany({
    select: {
      id: true,
      userId: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      receivedAt: true,
      emailType: true,
      retailer: true,
      orderNumber: true,
      orderDate: true,
      returnDeadline: true,
      orderTotal: true,
      needsReview: true,
      extractedAt: true,
      extractionNotes: true,
      orderId: true,
      junkedAt: true,
    },
    orderBy: { receivedAt: "desc" },
  });

  const amazonRows = all
    .map((e) => {
      let fromEmailPlain = "";
      let fromNamePlain: string | null = null;
      try {
        fromEmailPlain = decrypt(e.fromEmail);
      } catch {
        fromEmailPlain = "[decrypt-failed]";
      }
      try {
        fromNamePlain = e.fromName ? decrypt(e.fromName) : null;
      } catch {
        fromNamePlain = "[decrypt-failed]";
      }
      return { ...e, fromEmailPlain, fromNamePlain };
    })
    .filter((e) => isAmazonSender(e.fromEmailPlain, e.fromNamePlain, e.subject));

  console.log(`Total Email rows: ${all.length}`);
  console.log(`Amazon-sender rows (subject/from contains "amazon"): ${amazonRows.length}\n`);

  const blankRows = amazonRows.filter(
    (e) =>
      e.emailType === null ||
      (e.retailer === null && e.orderNumber === null && e.orderDate === null && e.returnDeadline === null),
  );

  console.log(`=== BLANK-EXTRACTION MATCHES: ${blankRows.length} ===`);
  console.log("(emailType null, OR retailer+orderNumber+orderDate+returnDeadline all null)\n");
  for (const e of blankRows) {
    console.log(`--- ${e.id} ---`);
    console.log(`  from: ${e.fromEmailPlain}${e.fromNamePlain ? ` (${e.fromNamePlain})` : ""}`);
    console.log(`  subject: ${e.subject ?? "null"}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
    console.log(`  emailType: ${e.emailType ?? "null"}`);
    console.log(`  retailer: ${e.retailer ?? "null"}`);
    console.log(`  orderNumber: ${e.orderNumber ?? "null"}`);
    console.log(`  orderDate: ${e.orderDate ? e.orderDate.toISOString() : "null"}`);
    console.log(`  returnDeadline: ${e.returnDeadline ? e.returnDeadline.toISOString() : "null"}`);
    console.log(`  orderTotal: ${e.orderTotal ?? "null"}`);
    console.log(`  extractedAt: ${e.extractedAt ? e.extractedAt.toISOString() : "null (never ran)"}`);
    console.log(`  needsReview: ${e.needsReview}`);
    console.log(`  junkedAt: ${e.junkedAt ? e.junkedAt.toISOString() : "null"}`);
    console.log(`  orderId (linked Order?): ${e.orderId ?? "null — NO ORDER CREATED/LINKED"}`);
    console.log(`  extractionNotes: ${e.extractionNotes ?? "null"}`);
    console.log("");
  }

  console.log(`=== MOST RECENT 5 AMAZON-SENDER EMAILS, REGARDLESS OF STATE ===\n`);
  for (const e of amazonRows.slice(0, 5)) {
    console.log(`--- ${e.id} ---`);
    console.log(`  from: ${e.fromEmailPlain}${e.fromNamePlain ? ` (${e.fromNamePlain})` : ""}`);
    console.log(`  subject: ${e.subject ?? "null"}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
    console.log(`  emailType: ${e.emailType ?? "null"}`);
    console.log(`  retailer: ${e.retailer ?? "null"}`);
    console.log(`  orderNumber: ${e.orderNumber ?? "null"}`);
    console.log(`  orderDate: ${e.orderDate ? e.orderDate.toISOString() : "null"}`);
    console.log(`  returnDeadline: ${e.returnDeadline ? e.returnDeadline.toISOString() : "null"}`);
    console.log(`  orderTotal: ${e.orderTotal ?? "null"}`);
    console.log(`  needsReview: ${e.needsReview}`);
    console.log(`  orderId (linked Order?): ${e.orderId ?? "null"}`);
    console.log("");
  }

  console.log("Done. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

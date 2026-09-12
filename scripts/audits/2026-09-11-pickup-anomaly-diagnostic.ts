// Read-only diagnostic for TASKS.md 🔴 Now "Diagnostic: pickup-order
// write-path / classifier anomaly — Shutterfly + Crate & Barrel."
// Zero writes. Zero Anthropic calls. Traces 1, 2, and 4 only (Trace 3
// needs a billed classifier call and is gated on owner confirmation).
//
// Usage: npx tsx scripts/audits/2026-09-11-pickup-anomaly-diagnostic.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";

const prisma = new PrismaClient();

function safeDecrypt(text: string | null): string | null {
  if (!text) return null;
  try {
    return decrypt(text);
  } catch {
    return "[decrypt-failed]";
  }
}

function domainOf(email: string | null): string {
  if (!email) return "(none)";
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(at + 1);
}

async function main() {
  console.log("PICKUP-ORDER ANOMALY DIAGNOSTIC — READ ONLY. Zero writes, zero Anthropic calls.\n");

  console.log("=== TRACE 1 + 2: Shutterfly order 5011207321227 ===\n");

  const shutterflyOrder = await prisma.order.findFirst({
    where: { orderNumber: "5011207321227" },
    include: {
      emails: {
        select: {
          id: true,
          messageId: true,
          subject: true,
          fromEmail: true,
          receivedAt: true,
          updatedAt: true,
          emailType: true,
          needsReview: true,
          extractionNotes: true,
          extractedAt: true,
          orderId: true,
          orderNumber: true,
          orderTotal: true,
          lineItems: true,
          junkedAt: true,
        },
        orderBy: { receivedAt: "asc" },
      },
    },
  });

  if (!shutterflyOrder) {
    console.log("No Order row found with orderNumber 5011207321227.");
  } else {
    console.log(`Order id: ${shutterflyOrder.id}`);
    console.log(`retailer: ${shutterflyOrder.retailer} | orderNumber: ${shutterflyOrder.orderNumber} | orderTotal: ${shutterflyOrder.orderTotal}`);
    console.log(`lineItems: ${JSON.stringify(shutterflyOrder.lineItems)}`);
    console.log(`createdAt: ${shutterflyOrder.createdAt.toISOString()} | updatedAt: ${shutterflyOrder.updatedAt.toISOString()}`);
    console.log(`\nLinked Email rows (${shutterflyOrder.emails.length}):`);
    for (const e of shutterflyOrder.emails) {
      console.log(`\n  id: ${e.id}`);
      console.log(`  messageId: ${e.messageId ?? "null"}`);
      console.log(`  subject: ${e.subject}`);
      console.log(`  from domain: ${domainOf(safeDecrypt(e.fromEmail))}`);
      console.log(`  receivedAt: ${e.receivedAt.toISOString()} | updatedAt: ${e.updatedAt?.toISOString() ?? "null"}`);
      console.log(`  emailType: ${e.emailType ?? "null"} | needsReview: ${e.needsReview} | extractedAt: ${e.extractedAt?.toISOString() ?? "null"}`);
      console.log(`  extractionNotes: ${e.extractionNotes ?? "null"}`);
      console.log(`  orderId: ${e.orderId ?? "null"} | own orderNumber: ${e.orderNumber ?? "null"} | own orderTotal: ${e.orderTotal ?? "null"}`);
      console.log(`  junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
    }
  }

  console.log("\n\n--- All Email rows mentioning 'Shutterfly' in fromEmail domain or subject (unlinked candidates included) ---");
  const allEmails = await prisma.email.findMany({
    select: {
      id: true, messageId: true, subject: true, fromEmail: true, receivedAt: true, updatedAt: true,
      emailType: true, needsReview: true, extractionNotes: true, extractedAt: true, orderId: true, junkedAt: true,
    },
    orderBy: { receivedAt: "asc" },
  });
  const shutterflyRows = allEmails.filter((e) => {
    const subj = (e.subject ?? "").toLowerCase();
    if (subj.includes("shutterfly")) return true;
    const from = safeDecrypt(e.fromEmail) ?? "";
    return from.toLowerCase().includes("shutterfly");
  });
  for (const e of shutterflyRows) {
    console.log(`\n  id: ${e.id} | messageId: ${e.messageId ?? "null"}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  from: ${safeDecrypt(e.fromEmail)}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()} | updatedAt: ${e.updatedAt?.toISOString() ?? "null"} | extractedAt: ${e.extractedAt?.toISOString() ?? "null"}`);
    console.log(`  emailType: ${e.emailType ?? "null"} | needsReview: ${e.needsReview} | extractionNotes: ${e.extractionNotes ?? "null"} | orderId: ${e.orderId ?? "null"} | junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
  }

  console.log("\n\n--- DiscardLog check (aggregate only, no per-row identity available) ---");
  const discardCounts = await prisma.discardLog.groupBy({
    by: ["reason"],
    _count: true,
  });
  console.log(discardCounts);

  console.log("\n\n--- DryRunCache: any Shutterfly-related messageIds? (checked against known messageId 5fa82d64...) ---");
  const dryRunRows = await prisma.dryRunCache.findMany({
    select: { messageId: true, isCommerce: true, extractionResult: true, createdAt: true },
  });
  console.log(`Total DryRunCache rows: ${dryRunRows.length}`);
  const shutterflyCache = dryRunRows.filter((r) => JSON.stringify(r.extractionResult ?? "").toLowerCase().includes("shutterfly"));
  console.log(`DryRunCache rows whose extractionResult mentions "shutterfly": ${shutterflyCache.length}`);
  for (const r of shutterflyCache) {
    console.log(`  messageId: ${r.messageId} | isCommerce: ${r.isCommerce} | createdAt: ${r.createdAt.toISOString()}`);
    console.log(`  extractionResult: ${JSON.stringify(r.extractionResult)}`);
  }

  console.log("\n\n=== TRACE (context): Crate & Barrel order 359173100 ===\n");
  const cbOrder = await prisma.order.findFirst({
    where: { orderNumber: "359173100" },
    include: {
      emails: {
        select: {
          id: true, messageId: true, subject: true, fromEmail: true, receivedAt: true,
          emailType: true, needsReview: true, extractionNotes: true, extractedAt: true, orderId: true, junkedAt: true,
        },
        orderBy: { receivedAt: "asc" },
      },
    },
  });
  if (!cbOrder) {
    console.log("No Order row found with orderNumber 359173100.");
  } else {
    console.log(`Order id: ${cbOrder.id} | retailer: ${cbOrder.retailer} | orderTotal: ${cbOrder.orderTotal}`);
    for (const e of cbOrder.emails) {
      console.log(`\n  id: ${e.id} | messageId: ${e.messageId ?? "null"}`);
      console.log(`  subject: ${e.subject}`);
      console.log(`  receivedAt: ${e.receivedAt.toISOString()} | emailType: ${e.emailType ?? "null"} | needsReview: ${e.needsReview}`);
    }
  }

  console.log("\n\n--- All Email rows mentioning 'Crate' / 'crateandbarrel' ---");
  const cbRows = allEmails.filter((e) => {
    const subj = (e.subject ?? "").toLowerCase();
    if (subj.includes("crate") || subj.includes("359173100")) return true;
    const from = safeDecrypt(e.fromEmail) ?? "";
    return from.toLowerCase().includes("crateandbarrel");
  });
  for (const e of cbRows) {
    console.log(`\n  id: ${e.id} | messageId: ${e.messageId ?? "null"}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  from: ${safeDecrypt(e.fromEmail)}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()} | updatedAt: ${e.updatedAt?.toISOString() ?? "null"} | extractedAt: ${e.extractedAt?.toISOString() ?? "null"}`);
    console.log(`  emailType: ${e.emailType ?? "null"} | needsReview: ${e.needsReview} | extractionNotes: ${e.extractionNotes ?? "null"} | orderId: ${e.orderId ?? "null"} | junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
  }

  console.log("\n\n=== TRACE 4a: Email rows with emailType NULL + needsReview false + orderId NULL + extractionNotes NULL ===\n");
  const anomalous = await prisma.email.findMany({
    where: { emailType: null, needsReview: false, orderId: null, extractionNotes: null },
    select: { id: true, fromEmail: true, subject: true, receivedAt: true, extractedAt: true, userId: true, junkedAt: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`Count: ${anomalous.length}`);
  if (anomalous.length > 0) {
    const byRetailerDomain = new Map<string, number>();
    for (const e of anomalous) {
      const domain = domainOf(safeDecrypt(e.fromEmail));
      byRetailerDomain.set(domain, (byRetailerDomain.get(domain) ?? 0) + 1);
    }
    console.log("\nGrouped by sender domain:");
    for (const [domain, count] of [...byRetailerDomain.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${domain}: ${count}`);
    }
    console.log("\nRow detail:");
    for (const e of anomalous) {
      console.log(`  id: ${e.id} | domain: ${domainOf(safeDecrypt(e.fromEmail))} | subject: ${(e.subject ?? "").slice(0, 60)} | receivedAt: ${e.receivedAt.toISOString()} | extractedAt: ${e.extractedAt?.toISOString() ?? "null"} | junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
    }
  }

  console.log("\n\n=== TRACE 4b: Order rows with orderNumber or orderTotal set but no linked order_confirmation email ===\n");
  const candidateOrders = await prisma.order.findMany({
    where: {
      OR: [{ orderNumber: { not: null } }, { orderTotal: { not: null } }],
    },
    select: {
      id: true, retailer: true, orderNumber: true, orderTotal: true, createdAt: true,
      emails: { select: { emailType: true } },
    },
  });
  const noConfirmation = candidateOrders.filter((o) => !o.emails.some((e) => e.emailType === "order_confirmation"));
  console.log(`Total candidate Orders (orderNumber or orderTotal set): ${candidateOrders.length}`);
  console.log(`Orders with NO linked order_confirmation email: ${noConfirmation.length}`);
  if (noConfirmation.length > 0) {
    const byRetailer = new Map<string, number>();
    for (const o of noConfirmation) {
      const key = o.retailer ?? "(null retailer)";
      byRetailer.set(key, (byRetailer.get(key) ?? 0) + 1);
    }
    console.log("\nGrouped by retailer:");
    for (const [retailer, count] of [...byRetailer.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${retailer}: ${count}`);
    }
    if (noConfirmation.length <= 30) {
      console.log("\nRow detail:");
      for (const o of noConfirmation) {
        console.log(`  id: ${o.id} | retailer: ${o.retailer ?? "null"} | orderNumber: ${o.orderNumber ?? "null"} | orderTotal: ${o.orderTotal ?? "null"} | emailTypes linked: ${JSON.stringify(o.emails.map((e) => e.emailType))}`);
      }
    }
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

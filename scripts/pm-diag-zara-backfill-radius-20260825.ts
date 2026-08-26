/**
 * scripts/pm-diag-zara-backfill-radius-20260825.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls — findMany/findFirst only,
 * no runExtraction/extractEmail/Haiku/Sonnet path touched. 0 DB writes.
 *
 * Follow-up to scripts/pm-diag-zara-retailer-fallback-20260825.ts
 * (commit 0f8a94f). Pulls the actual instance population (the 8
 * commerce-typed null-retailer Email rows + every null-retailer Order row)
 * and previews what a fromName/domain fallback would produce for each, so
 * the backfill blast-radius question can be reasoned about against real
 * data instead of the earlier aggregate count. Does not write anything —
 * "proposed fallback" column is a preview computed in memory only.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

const GENERIC_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "hello", "team", "support", "orders", "notifications",
  "info", "contact", "help", "service", "customerservice", "care",
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(at + 1).toLowerCase();
}

function localPartOf(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at).toLowerCase();
}

function titleCaseDomainLabel(domain: string): string {
  const registrable = domain.split(".").slice(-2)[0] ?? domain;
  return registrable.charAt(0).toUpperCase() + registrable.slice(1);
}

function previewFallback(fromEmail: string, fromName: string | null): { value: string | null; source: "fromName" | "domain" | "none" } {
  if (fromName && fromName.trim().length > 0) {
    const normalized = fromName.trim().toLowerCase();
    if (!GENERIC_LOCAL_PARTS.has(normalized) && !GENERIC_LOCAL_PARTS.has(localPartOf(fromEmail))) {
      return { value: fromName.trim(), source: "fromName" };
    }
  }
  const domain = domainOf(fromEmail);
  if (domain) {
    return { value: titleCaseDomainLabel(domain), source: "domain" };
  }
  return { value: null, source: "none" };
}

const INDITEX_DOMAINS = ["zara.com", "massimodutti.com", "pullandbear.com", "bershka.com", "stradivarius.com", "oysho.com"];

async function main() {
  console.log("=== QUESTION 1a: commerce-typed Email rows with retailer IS NULL ===\n");

  const commerceTypes = ["order_confirmation", "shipping_confirmation", "delivery", "return_label", "refund"];
  const nullRetailerCommerce = await prisma.email.findMany({
    where: { retailer: null, emailType: { in: commerceTypes } },
    select: {
      id: true, emailType: true, receivedAt: true, subject: true, orderId: true,
      orderNumber: true, extractionNotes: true, fromEmail: true, fromName: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Row count: ${nullRetailerCommerce.length}\n`);

  const grouped: Record<string, typeof nullRetailerCommerce> = {};

  for (const e of nullRetailerCommerce) {
    const dec = decryptEmailContent(e as any);
    const domain = domainOf(dec.fromEmail);
    const family = INDITEX_DOMAINS.includes(domain) ? "Inditex family" : domain;
    (grouped[family] ??= []).push(e);

    let orderInfo = "not linked (orderId: null)";
    if (e.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: e.orderId },
        select: { id: true, orderNumber: true, retailer: true },
      });
      orderInfo = order
        ? `linked -> Order ${order.id} #${order.orderNumber ?? "(none)"} Order.retailer=${order.retailer}`
        : `orderId ${e.orderId} set but Order row not found (dangling)`;
    }

    const fallback = previewFallback(dec.fromEmail, dec.fromName);
    const subject = (e.subject ?? "").slice(0, 80);

    console.log(`Email ${e.id}`);
    console.log(`  emailType=${e.emailType}  receivedAt=${e.receivedAt.toISOString()}`);
    console.log(`  fromEmail=${dec.fromEmail}  fromName=${dec.fromName ?? "(null)"}`);
    console.log(`  subject="${subject}"`);
    console.log(`  ${orderInfo}`);
    console.log(`  orderNumber=${e.orderNumber ?? "(null)"}`);
    console.log(`  proposed fallback => ${fallback.value ?? "(none — would stay Unknown)"}  [source: ${fallback.source}]`);
    console.log(`  extractionNotes: ${e.extractionNotes ?? "(none)"}`);
    console.log("");
  }

  console.log("\n=== Grouping by domain/family (generalizes-beyond-Zara check) ===\n");
  for (const [family, rows] of Object.entries(grouped)) {
    console.log(`${family}: ${rows.length} row(s) — ${rows.map((r) => r.id).join(", ")}`);
  }

  console.log("\n\n=== QUESTION 1b: Order rows with retailer IS NULL ===\n");
  const nullRetailerOrders = await prisma.order.findMany({
    where: { retailer: null },
    select: {
      id: true, orderNumber: true, orderDate: true, orderTotal: true, orderCurrency: true,
      emails: { select: { id: true, emailType: true, retailer: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Row count: ${nullRetailerOrders.length}\n`);
  const orderFamilyGroups: Record<string, typeof nullRetailerOrders> = {};
  for (const o of nullRetailerOrders) {
    console.log(`Order ${o.id}  #${o.orderNumber ?? "(none)"}  orderDate=${o.orderDate?.toISOString() ?? "(null)"}  total=${o.orderTotal ?? "(null)"} ${o.orderCurrency ?? ""}`);
    console.log(`  linked emails (${o.emails.length}): ${o.emails.map((e) => `${e.id}[${e.emailType}, retailer=${e.retailer}]`).join(", ")}`);
    const overlapsQ1a = o.emails.some((e) => nullRetailerCommerce.some((n) => n.id === e.id));
    console.log(`  overlaps Q1a set: ${overlapsQ1a}`);
    console.log("");
    (orderFamilyGroups["all"] ??= []).push(o);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

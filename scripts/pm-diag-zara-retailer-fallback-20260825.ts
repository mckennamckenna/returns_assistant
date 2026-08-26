/**
 * scripts/pm-diag-zara-retailer-fallback-20260825.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls — findMany/findFirst only,
 * no runExtraction/extractEmail/Haiku/Sonnet path touched. 0 DB writes.
 *
 * Purpose: answer the six pre-design questions for the Zara "unknown
 * retailer" fallback (TASKS.md 🔴 Now, Bugs → "Zara retailer identification
 * failure despite visible signal") with real data, before
 * ZARA_RETAILER_FALLBACK_DESIGN.md is written. Does not propose or apply a
 * fix. Findings written up separately in ZARA_DIAGNOSTIC_FINDINGS_20260825.md.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email : email.slice(at + 1).toLowerCase();
}

async function main() {
  // --- Q1: fromEmail/fromName distribution + the Zara row specifically ---
  // Order lookup by orderNumber "54421192781" returns nothing — the Zara
  // Email rows were never linked into an Order (orderId is null on all of
  // them), so the actual Zara evidence lives on the Email rows directly.
  console.log("=== Q1: Zara Email rows (fromEmail contains 'zara') ===");
  const allEmailsForZara = await prisma.email.findMany({});
  const zaraRows = allEmailsForZara.filter((e) => {
    const dec = decryptEmailContent(e as any);
    return dec.fromEmail.toLowerCase().includes("zara") || (dec.fromName ?? "").toLowerCase().includes("zara");
  });
  for (const e of zaraRows) {
    const dec = decryptEmailContent(e as any);
    console.log(
      `  Email ${e.id}: fromEmail=${dec.fromEmail} fromName=${dec.fromName} emailType=${e.emailType} retailer=${e.retailer} orderNumber=${e.orderNumber} orderId=${e.orderId}`
    );
  }

  const allEmails = await prisma.email.findMany({
    select: { id: true, fromEmail: true, fromName: true, retailer: true, emailType: true, userId: true },
  });
  const domainCounts = new Map<string, number>();
  for (const e of allEmails) {
    const dec = decryptEmailContent(e as any);
    const d = domainOf(dec.fromEmail);
    domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }
  console.log(`\nTotal Email rows: ${allEmails.length}`);
  console.log("fromEmail domain distribution (top 20):");
  [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([d, c]) => console.log(`  ${d}: ${c}`));

  // --- Q3: forwarding-source address storage ---
  console.log("\n=== Q3: User model forwarding-address fields ===");
  const userSample = await prisma.user.findFirst({});
  console.log("User row keys:", userSample ? Object.keys(userSample) : "(no users)");

  // --- Q4: null-retailer population, by domain shape ---
  const nullRetailerEmails = await prisma.email.findMany({
    where: { retailer: null },
    select: { id: true, fromEmail: true, fromName: true, emailType: true },
  });
  console.log(`\n=== Q4: retailer IS NULL — ${nullRetailerEmails.length} rows ===`);
  const shapeBuckets: Record<string, { count: number; emailTypes: Map<string | null, number>; domains: Map<string, number> }> = {
    brandDirect: { count: 0, emailTypes: new Map(), domains: new Map() },
    esp: { count: 0, emailTypes: new Map(), domains: new Map() },
    forwardingShaped: { count: 0, emailTypes: new Map(), domains: new Map() },
    other: { count: 0, emailTypes: new Map(), domains: new Map() },
  };
  const ESP_HINTS = ["shopifyemail", "sendgrid", "mailgun", "klaviyo", "mktg", "marketing", "mandrillapp", "sparkpost", "postmarkapp"];
  const userForwardEmails = new Set(
    (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email?.toLowerCase()).filter(Boolean)
  );

  for (const e of nullRetailerEmails) {
    const dec = decryptEmailContent(e as any);
    const d = domainOf(dec.fromEmail);
    let bucket: string;
    if (userForwardEmails.has(dec.fromEmail.toLowerCase()) || d.includes("postmarkapp")) {
      bucket = "forwardingShaped";
    } else if (ESP_HINTS.some((h) => d.includes(h))) {
      bucket = "esp";
    } else if (/^[a-z0-9.-]+\.(com|co|net|org|io)$/i.test(d) && !d.includes("mail.") ) {
      bucket = "brandDirect";
    } else {
      bucket = "other";
    }
    const b = shapeBuckets[bucket];
    b.count++;
    b.emailTypes.set(e.emailType, (b.emailTypes.get(e.emailType) ?? 0) + 1);
    b.domains.set(d, (b.domains.get(d) ?? 0) + 1);
  }
  for (const [name, b] of Object.entries(shapeBuckets)) {
    console.log(`\n-- ${name}: ${b.count} rows`);
    console.log("   emailType breakdown:", [...b.emailTypes.entries()].map(([k, v]) => `${k ?? "null"}:${v}`).join(", "));
    console.log("   top domains:", [...b.domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, c]) => `${d}(${c})`).join(", "));
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

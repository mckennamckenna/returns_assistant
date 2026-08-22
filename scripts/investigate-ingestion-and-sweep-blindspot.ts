// Two urgent read-only investigations, no fixes. READ-ONLY — zero writes,
// zero Anthropic calls.
//
// Usage: npx tsx scripts/investigate-ingestion-and-sweep-blindspot.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { extractDomain, isFoodGroceryDomain, FOOD_GROCERY_SENDER_DOMAINS, AMAZON_FOOD_RETAILER_NAMES } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

// Deploy landed 2026-08-20 ~07:47 PT (14:47 UTC) — confirmed via
// `npx vercel inspect` in the prior session turn.
const DEPLOY_AT = new Date("2026-08-20T14:47:48.000Z");

const FOOD_GROCERY_NAMES = [
  "doordash",
  "uber eats",
  "ubereats",
  "grubhub",
  "instacart",
  "postmates",
  "caviar",
  "whole foods",
  "good eggs",
  "goodeggs",
];

async function main() {
  console.log("READ-ONLY. Zero writes, zero Anthropic calls.\n");

  // ==================== INVESTIGATION 1 ====================
  console.log("########## INVESTIGATION 1 — ingestion architecture ##########\n");

  console.log("=== 1b. fromDomain distribution — last 100 inbound Emails ===");
  const last100 = await prisma.email.findMany({
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { id: true, fromEmail: true, receivedAt: true, forwardType: true },
  });

  const domainCounts = new Map<string, number>();
  let foodGroceryDomainHits = 0;
  for (const e of last100) {
    let domain = "[decrypt-failed]";
    try {
      domain = extractDomain(decrypt(e.fromEmail));
    } catch {
      domain = "[decrypt-failed]";
    }
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    if (isFoodGroceryDomain(domain)) foodGroceryDomainHits++;
  }

  const sortedDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Sampled ${last100.length} most recent inbound Emails. Distinct sender domains: ${sortedDomains.length}`);
  for (const [domain, count] of sortedDomains.slice(0, 20)) {
    console.log(`  ${domain}: ${count}`);
  }
  if (sortedDomains.length > 20) console.log(`  ... and ${sortedDomains.length - 20} more distinct domains`);
  console.log(`\nOf these 100, how many are on the enumerated FOOD_GROCERY_SENDER_DOMAINS list: ${foodGroceryDomainHits}`);

  const forwardTypeCounts = new Map<string, number>();
  for (const e of last100) {
    const key = e.forwardType ?? "null";
    forwardTypeCounts.set(key, (forwardTypeCounts.get(key) ?? 0) + 1);
  }
  console.log("\nforwardType distribution (same 100 rows):");
  for (const [type, count] of forwardTypeCounts) console.log(`  ${type}: ${count}`);

  console.log("\n=== 1c. Real food/grocery emails since deploy, matched on subject/body, NOT pre-junked ===");
  console.log(`Deploy time used as cutoff: ${DEPLOY_AT.toISOString()}`);
  const sinceDeploy = await prisma.email.findMany({
    where: { receivedAt: { gte: DEPLOY_AT } },
    select: { id: true, subject: true, textBody: true, htmlBody: true, retailer: true, junkedAt: true, receivedAt: true, fromEmail: true },
  });
  console.log(`Total Emails received since deploy: ${sinceDeploy.length}`);

  let sinceDeployMisses = 0;
  for (const e of sinceDeploy) {
    const subj = (e.subject ?? "").toLowerCase();
    let bodyPlain = "";
    try {
      bodyPlain = e.textBody ? decrypt(e.textBody).toLowerCase() : e.htmlBody ? decrypt(e.htmlBody).toLowerCase() : "";
    } catch {
      bodyPlain = "";
    }
    const hay = `${subj} ${bodyPlain}`;
    const matchedName = FOOD_GROCERY_NAMES.find((n) => hay.includes(n));
    if (matchedName && e.junkedAt == null) {
      sinceDeployMisses++;
      let fromPlain = "";
      try {
        fromPlain = decrypt(e.fromEmail);
      } catch {
        fromPlain = "[decrypt-failed]";
      }
      console.log(`  MISS id=${e.id} matched="${matchedName}" subject="${e.subject}" retailer=${e.retailer ?? "null"} from=${fromPlain} receivedAt=${e.receivedAt.toISOString()}`);
    }
  }
  console.log(`Total misses since deploy (content-matched, junkedAt still null): ${sinceDeployMisses}`);

  // ==================== INVESTIGATION 2 ====================
  console.log("\n\n########## INVESTIGATION 2 — sweep blind spot ##########\n");

  console.log('=== 2a/2b. Whole Foods rows, 7/21/2026, subject "Your Whole Foods Market order has been picked up" ===');
  const wholeFoodsRows = await prisma.email.findMany({
    where: {
      subject: { contains: "Your Whole Foods Market order has been picked up" },
    },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`Rows found: ${wholeFoodsRows.length}`);
  for (const e of wholeFoodsRows) {
    let fromPlain = "";
    try {
      fromPlain = decrypt(e.fromEmail);
    } catch {
      fromPlain = "[decrypt-failed]";
    }
    console.log(`\n  id: ${e.id}`);
    console.log(`  messageId: ${e.messageId ?? "null"}`);
    console.log(`  retailer: ${e.retailer ?? "null"}`);
    console.log(`  emailType: ${e.emailType ?? "null"}`);
    console.log(`  junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
    console.log(`  orderId: ${e.orderId ?? "null"}`);
    console.log(`  fromEmail (decrypted): ${fromPlain}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
    console.log(`  createdAt: n/a (Email model has no separate createdAt — receivedAt is the timestamp field)`);
    console.log(`  extractedAt: ${e.extractedAt?.toISOString() ?? "null"}`);
    console.log(`  userId: ${e.userId}`);
  }

  const distinctMessageIds = new Set(wholeFoodsRows.map((e) => e.messageId).filter(Boolean));
  const distinctIds = new Set(wholeFoodsRows.map((e) => e.id));
  console.log(`\nDistinct row ids: ${distinctIds.size} (of ${wholeFoodsRows.length} rows)`);
  console.log(`Distinct non-null messageIds: ${distinctMessageIds.size}`);
  console.log(`Rows with messageId null: ${wholeFoodsRows.filter((e) => e.messageId == null).length}`);

  console.log("\n=== 2c. Full-history census on SUBJECT/BODY content (not retailer field), junkedAt null ===");
  const allEmails = await prisma.email.findMany({
    select: { id: true, subject: true, textBody: true, htmlBody: true, retailer: true, junkedAt: true, orderId: true, receivedAt: true },
  });

  const byName = new Map<string, { total: number; stillLive: number }>();
  for (const name of FOOD_GROCERY_NAMES) byName.set(name, { total: 0, stillLive: 0 });

  const liveMisses: typeof allEmails = [];
  for (const e of allEmails) {
    const subj = (e.subject ?? "").toLowerCase();
    let bodyPlain = "";
    try {
      bodyPlain = e.textBody ? decrypt(e.textBody).toLowerCase() : e.htmlBody ? decrypt(e.htmlBody).toLowerCase() : "";
    } catch {
      bodyPlain = "";
    }
    const hay = `${subj} ${bodyPlain}`;
    const matchedName = FOOD_GROCERY_NAMES.find((n) => hay.includes(n));
    if (!matchedName) continue;

    const bucket = byName.get(matchedName)!;
    bucket.total++;
    if (e.junkedAt == null) {
      bucket.stillLive++;
      liveMisses.push(e);
    }
  }

  console.log("Matches by enumerated name (total matched / still live i.e. junkedAt: null):");
  for (const [name, { total, stillLive }] of byName) {
    if (total > 0) console.log(`  "${name}": ${total} total, ${stillLive} still live (junkedAt: null)`);
  }
  const totalStillLive = [...byName.values()].reduce((s, b) => s + b.stillLive, 0);
  console.log(`\nTRUE SIZE OF THE SWEEP MISS — content-matched, junkedAt still null: ${totalStillLive}`);

  const linkedMisses = liveMisses.filter((e) => e.orderId != null);
  console.log(`Of those, linked to an Order (orderId not null): ${linkedMisses.length}`);
  if (linkedMisses.length > 0) {
    const orderIds = [...new Set(linkedMisses.map((e) => e.orderId).filter((id): id is string => id != null))];
    console.log(`  Distinct Orders potentially affected: ${orderIds.length} (${orderIds.join(", ")})`);
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

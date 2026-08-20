// Food + grocery delivery exclusion (category-level) — Step 0 census.
// TASKS.md 🔴 Now, scoped 2026-08-18. READ-ONLY — zero writes, zero
// Anthropic calls. fromEmail/fromName are encrypted at rest (lib/crypto.ts,
// random IV per row) so domain matching cannot happen at the DB level;
// every row is decrypted in JS instead, same pattern as the existing
// scripts/census-amazon-grocery-scope.ts and census-amazon-blank-extraction.ts.
//
// Usage: npx tsx scripts/census-food-grocery-exclusion.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { isAmazonOrder } from "../lib/amazonBundle";

const prisma = new PrismaClient();

// Owner-locked enumerated list (TASKS.md 🔴 Now, 2026-08-18).
const SENDER_DOMAINS = [
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "instacart.com",
  "postmates.com",
  "caviar.com",
  "wholefoodsmarket.com",
  "goodeggs.com",
] as const;

// Amazon-brand food retailer names — the post-extraction backstop population.
const AMAZON_FOOD_RETAILERS = ["amazon fresh", "whole foods market"];

// Broader net for "candidates not on the list" — common food-delivery /
// grocery brand and keyword signals, checked against decrypted
// fromEmail/fromName + subject + retailer. Deliberately wider than the
// enumerated list so it can surface misses; not itself a detection rule.
const CANDIDATE_KEYWORDS = [
  "seamless",
  "gopuff",
  "shipt",
  "freshdirect",
  "fresh direct",
  "peapod",
  "kroger",
  "safeway",
  "instawork", // decoy-check: not food, included to confirm keyword scan isn't over-matching
  "walmart grocery",
  "target grocery",
  "chownow",
  "toasttab",
  "ritual",
  "eat24",
  "ezcater",
  "ez cater",
  "ocado",
  "misfits market",
  "imperfect foods",
  "hellofresh",
  "hello fresh",
  "blue apron",
  "home chef",
  "farmbox",
  "farm box",
  "grocery",
  "food delivery",
];

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

function matchesEnumeratedDomain(domain: string): string | null {
  return SENDER_DOMAINS.find((d) => domain === d || domain.endsWith(`.${d}`)) ?? null;
}

async function main() {
  console.log("READ-ONLY. Zero writes, zero Anthropic calls.\n");

  const allEmails = await prisma.email.findMany({
    select: {
      id: true,
      fromEmail: true,
      fromName: true,
      subject: true,
      retailer: true,
      orderId: true,
      receivedAt: true,
      junkedAt: true,
      emailType: true,
    },
  });

  const decorated = allEmails.map((e) => {
    let fromEmailPlain = "";
    let fromNamePlain = "";
    try {
      fromEmailPlain = decrypt(e.fromEmail).toLowerCase();
    } catch {
      fromEmailPlain = "[decrypt-failed]";
    }
    try {
      fromNamePlain = e.fromName ? decrypt(e.fromName).toLowerCase() : "";
    } catch {
      fromNamePlain = "[decrypt-failed]";
    }
    const domain = fromEmailPlain === "[decrypt-failed]" ? "" : domainOf(fromEmailPlain);
    return { ...e, fromEmailPlain, fromNamePlain, domain };
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const last30 = decorated.filter((e) => e.receivedAt >= thirtyDaysAgo);

  // ---------- 1. Sender-domain hit count, last 30 days ----------
  console.log("=== 1. Sender-domain hits — last 30 days (inbound Emails) ===");
  console.log(`Total inbound Emails, last 30 days: ${last30.length}`);
  let last30Total = 0;
  for (const dom of SENDER_DOMAINS) {
    const hits = last30.filter((e) => matchesEnumeratedDomain(e.domain) === dom);
    last30Total += hits.length;
    console.log(`  ${dom}: ${hits.length}`);
  }
  console.log(`  TOTAL enumerated-domain hits, last 30 days: ${last30Total}`);

  // ---------- 2. Full-history hit count ----------
  console.log("\n=== 2. Full-history hits — sender-domain + retailer-name backstop ===");
  console.log(`Total Emails, all history: ${decorated.length}`);
  let fullHistoryDomainTotal = 0;
  const domainMatchedEmails: typeof decorated = [];
  for (const dom of SENDER_DOMAINS) {
    const hits = decorated.filter((e) => matchesEnumeratedDomain(e.domain) === dom);
    fullHistoryDomainTotal += hits.length;
    domainMatchedEmails.push(...hits);
    console.log(`  ${dom}: ${hits.length}`);
  }
  console.log(`  TOTAL enumerated-domain hits, full history: ${fullHistoryDomainTotal}`);

  const retailerBackstopEmails = decorated.filter((e) =>
    AMAZON_FOOD_RETAILERS.some((r) => (e.retailer ?? "").toLowerCase() === r),
  );
  console.log(`\n  Retailer-name backstop (Amazon-brand food, post-extraction):`);
  for (const r of AMAZON_FOOD_RETAILERS) {
    const hits = decorated.filter((e) => (e.retailer ?? "").toLowerCase() === r);
    console.log(`  retailer="${r}": ${hits.length}`);
  }
  console.log(`  TOTAL retailer-backstop hits, full history: ${retailerBackstopEmails.length}`);

  const allMatchedEmails = [...domainMatchedEmails, ...retailerBackstopEmails];
  console.log(`\n  COMBINED (domain + backstop), full history: ${allMatchedEmails.length}`);

  // ---------- 3. Orders that would be deleted ----------
  console.log("\n=== 3. Orders that would be deleted as a consequence ===");
  const matchedOrderIds = [...new Set(allMatchedEmails.map((e) => e.orderId).filter((id): id is string => id != null))];
  console.log(`Distinct Orders linked to a matched Email: ${matchedOrderIds.length}`);

  if (matchedOrderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: matchedOrderIds } },
      include: { emails: { select: { id: true, orderId: true } } },
    });
    for (const o of orders) {
      const siblingCount = o.emails.length;
      const matchedSiblingIds = new Set(allMatchedEmails.filter((e) => e.orderId === o.id).map((e) => e.id));
      const nonMatchedSiblings = o.emails.filter((e) => !matchedSiblingIds.has(e.id));
      console.log(
        `  Order ${o.id} retailer=${o.retailer ?? "null"} status=${o.status} displayStatus=${o.displayStatus} needsReview=${o.needsReview} linkedEmails=${siblingCount} nonMatchedSiblingEmails=${nonMatchedSiblings.length}`,
      );
    }
  }

  // ---------- 4. Food/grocery senders NOT on the enumerated list ----------
  console.log("\n=== 4. Candidates NOT on the enumerated list (broader keyword scan) ===");
  const alreadyMatchedIds = new Set(allMatchedEmails.map((e) => e.id));
  const candidateHits = decorated.filter((e) => {
    if (alreadyMatchedIds.has(e.id)) return false;
    const hay = `${e.fromEmailPlain} ${e.fromNamePlain} ${(e.subject ?? "").toLowerCase()} ${(e.retailer ?? "").toLowerCase()}`;
    return CANDIDATE_KEYWORDS.some((k) => hay.includes(k));
  });
  if (candidateHits.length === 0) {
    console.log("  None found.");
  } else {
    const byDomainOrRetailer = new Map<string, number>();
    for (const e of candidateHits) {
      const key = e.domain || e.retailer || "[unknown]";
      byDomainOrRetailer.set(key, (byDomainOrRetailer.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byDomainOrRetailer) {
      console.log(`  ${key}: ${count}`);
    }
    console.log(`  (${candidateHits.length} total Email(s) — inspect individually before adding to the list)`);
  }

  // ---------- 5. Amazon-brand food services present ----------
  console.log("\n=== 5. Amazon-brand food services present (retailer field) ===");
  const distinctRetailers = [...new Set(decorated.map((e) => e.retailer).filter((r): r is string => r != null))];
  const amazonRetailers = distinctRetailers.filter((r) => isAmazonOrder(r) || r.toLowerCase().includes("whole foods"));
  console.log(`Distinct retailer values matching isAmazonOrder() or containing "whole foods": ${amazonRetailers.length}`);
  for (const r of amazonRetailers) {
    console.log(`  "${r}"`);
  }
  const onlyExpected = amazonRetailers.every(
    (r) => isAmazonOrder(r) === false || AMAZON_FOOD_RETAILERS.includes(r.toLowerCase()) || r.toLowerCase() === "amazon",
  );
  console.log(`Confirmed Amazon Fresh + Whole Foods Market are the only Amazon-brand food services: ${onlyExpected ? "YES (pending manual eyeball of the list above)" : "NO — see list above"}`);

  // ---------- 7. Anomalies ----------
  console.log("\n=== 7. Anomalies (flagged, not resolved) ===");
  const alreadyJunkedMatches = allMatchedEmails.filter((e) => e.junkedAt != null);
  console.log(`Matched Emails already junked by another path: ${alreadyJunkedMatches.length}`);
  for (const e of alreadyJunkedMatches) {
    console.log(`  id=${e.id} junkedAt=${e.junkedAt?.toISOString()} emailType=${e.emailType ?? "null"}`);
  }

  if (matchedOrderIds.length > 0) {
    const midFlowStatuses = ["return_started", "refund_pending", "returnable", "completed"];
    const midFlowOrders = await prisma.order.findMany({
      where: { id: { in: matchedOrderIds }, status: { in: midFlowStatuses } },
    });
    console.log(`\nOrders in a mid-return-flow status among the would-be-deleted set: ${midFlowOrders.length}`);
    for (const o of midFlowOrders) {
      console.log(`  id=${o.id} retailer=${o.retailer ?? "null"} status=${o.status} displayStatus=${o.displayStatus}`);
    }

    const midFlowDisplay = await prisma.order.findMany({
      where: { id: { in: matchedOrderIds }, displayStatus: { in: ["return_requested", "returned", "refunded", "kept"] } },
    });
    console.log(`\nOrders with a user-set displayStatus (manual action taken) among the would-be-deleted set: ${midFlowDisplay.length}`);
    for (const o of midFlowDisplay) {
      console.log(`  id=${o.id} retailer=${o.retailer ?? "null"} displayStatus=${o.displayStatus}`);
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

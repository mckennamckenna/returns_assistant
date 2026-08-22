// Deep-dive on the 4 data requests from the owner's follow-up. READ-ONLY —
// zero writes, zero Anthropic calls. No remediation, data only.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { extractDomain, isFoodGroceryDomain, FOOD_GROCERY_SENDER_DOMAINS } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();
const DEPLOY_AT = new Date("2026-08-20T14:47:48.000Z");
const FOOD_GROCERY_NAMES = ["doordash", "uber eats", "ubereats", "grubhub", "instacart", "postmates", "caviar", "whole foods", "good eggs", "goodeggs"];

function contentMatches(subject: string | null, bodyPlain: string): string | null {
  const hay = `${(subject ?? "").toLowerCase()} ${bodyPlain.toLowerCase()}`;
  return FOOD_GROCERY_NAMES.find((n) => hay.includes(n)) ?? null;
}

async function main() {
  console.log("READ-ONLY. Zero writes, zero Anthropic calls.\n");

  // ==================== REQUEST 1 ====================
  console.log("########## 1. fromDomain distribution ##########\n");

  for (const [label, take] of [["last 100", 100], ["last 500 (wider)", 500]] as const) {
    const rows = await prisma.email.findMany({ orderBy: { receivedAt: "desc" }, take, select: { fromEmail: true } });
    const counts = new Map<string, number>();
    for (const e of rows) {
      let domain = "[decrypt-failed]";
      try { domain = extractDomain(decrypt(e.fromEmail)); } catch { /* keep failed marker */ }
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`=== Top 20 domains, ${label} (n=${rows.length}) ===`);
    for (const [domain, count] of sorted.slice(0, 20)) console.log(`  ${domain}: ${count}`);
    console.log("");
  }

  console.log("=== Matched-against-enumerated-list hits SINCE DEPLOY, by domain ===");
  const sinceDeployEmails = await prisma.email.findMany({
    where: { receivedAt: { gte: DEPLOY_AT } },
    select: { id: true, fromEmail: true, junkedAt: true, receivedAt: true },
  });
  const sinceDeployByDomain = new Map<string, number>();
  for (const e of sinceDeployEmails) {
    let domain = "";
    try { domain = extractDomain(decrypt(e.fromEmail)); } catch { domain = ""; }
    if (isFoodGroceryDomain(domain)) {
      const matchedList = FOOD_GROCERY_SENDER_DOMAINS.find((d) => domain === d || domain.endsWith(`.${d}`))!;
      sinceDeployByDomain.set(matchedList, (sinceDeployByDomain.get(matchedList) ?? 0) + 1);
      console.log(`  id=${e.id} domain=${domain} junkedAt=${e.junkedAt?.toISOString() ?? "null"} receivedAt=${e.receivedAt.toISOString()}`);
    }
  }
  console.log(`Total Emails since deploy: ${sinceDeployEmails.length}`);
  console.log(`Total matched-enumerated-domain hits since deploy: ${[...sinceDeployByDomain.values()].reduce((a, b) => a + b, 0)}`);
  for (const [d, c] of sinceDeployByDomain) console.log(`  ${d}: ${c}`);

  // ==================== REQUEST 2 ====================
  console.log("\n\n########## 2. Manual-forward analysis ##########\n");

  const allEmailsWithUser = await prisma.email.findMany({
    select: {
      id: true, fromEmail: true, subject: true, textBody: true, htmlBody: true,
      forwardType: true, userId: true, retailer: true, junkedAt: true,
    },
  });
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const userById = new Map(users.map((u) => [u.id, u.email]));

  let addressMatchCount = 0;
  const addressMatchRows: typeof allEmailsWithUser = [];
  for (const e of allEmailsWithUser) {
    let fromPlain = "";
    try { fromPlain = decrypt(e.fromEmail).toLowerCase(); } catch { fromPlain = ""; }
    const ownerEmail = (userById.get(e.userId) ?? "").toLowerCase();
    if (ownerEmail && fromPlain === ownerEmail) {
      addressMatchCount++;
      addressMatchRows.push(e);
    }
  }
  console.log(`Emails where decrypted fromEmail EXACTLY equals the owning User.email: ${addressMatchCount}`);

  const forwardTypeManualCount = allEmailsWithUser.filter((e) => e.forwardType === "manual").length;
  console.log(`Emails where forwardType === "manual" (existing header-heuristic field): ${forwardTypeManualCount}`);

  const overlap = addressMatchRows.filter((e) => e.forwardType === "manual").length;
  console.log(`Overlap between the two signals: ${overlap} of ${addressMatchCount} address-match rows also have forwardType "manual"`);

  console.log("\n--- For each own-address (manual-forward) row: would the CORRECT inner-sender check have caught it? ---");
  const fwdFromLineRe = /^(?:>\s*)*From:\s*(.+)$/m;
  let parseable = 0;
  let innerDomainWouldMatch = 0;
  let contentWouldMatch = 0;
  for (const e of addressMatchRows) {
    let bodyPlain = "";
    try { bodyPlain = e.textBody ? decrypt(e.textBody) : e.htmlBody ? decrypt(e.htmlBody) : ""; } catch { bodyPlain = ""; }
    const m = bodyPlain.match(fwdFromLineRe);
    let innerDomain: string | null = null;
    if (m) {
      parseable++;
      const emailMatch = m[1].match(/[\w.+-]+@[\w.-]+/);
      if (emailMatch) innerDomain = extractDomain(emailMatch[0]);
    }
    const innerMatches = innerDomain ? isFoodGroceryDomain(innerDomain) : false;
    if (innerMatches) innerDomainWouldMatch++;
    const contentMatch = contentMatches(e.subject, bodyPlain);
    if (contentMatch) contentWouldMatch++;
    console.log(
      `  id=${e.id} subject="${e.subject}" retailer=${e.retailer ?? "null"} junkedAt=${e.junkedAt?.toISOString() ?? "null"} quotedFromParsed=${m ? "yes" : "no"} innerDomain=${innerDomain ?? "n/a"} innerDomainIsFoodGrocery=${innerMatches} contentMatch=${contentMatch ?? "none"}`,
    );
  }
  console.log(`\nOf ${addressMatchCount} manual-forward (own-address) rows: ${parseable} had a parseable quoted "From:" line in the body.`);
  console.log(`  Of those, ${innerDomainWouldMatch} had an inner sender domain that IS on the enumerated food/grocery list.`);
  console.log(`  Separately, ${contentWouldMatch} had subject/body content matching an enumerated name (regardless of header parseability).`);

  // ==================== REQUEST 3 ====================
  console.log("\n\n########## 3. \"3 orphaned Emails\" — precise definition + adjacent queries ##########\n");

  console.log("Original query for the 4 duplicate rows: Email.subject CONTAINS the exact string");
  console.log('  "Your Whole Foods Market order has been picked up"');
  console.log("Of those 4, \"orphaned\"/\"never entered extraction\" was characterized as: extractedAt IS NULL AND emailType IS NULL AND retailer IS NULL");
  console.log("(3 of the 4 rows satisfy all three simultaneously; the 4th has all three populated.)\n");

  const extractedAtNull = await prisma.email.count({ where: { extractedAt: null } });
  const emailTypeNull = await prisma.email.count({ where: { emailType: null } });
  const retailerNullJunkedNull = await prisma.email.count({ where: { retailer: null, junkedAt: null } });
  const noOrderNoExtractedAt = await prisma.email.count({ where: { orderId: null, extractedAt: null } });

  console.log("=== Adjacent query shapes, FULL population (not food/grocery-filtered) ===");
  console.log(`  extractedAt IS NULL (never had an extraction attempt/outcome recorded, ever, any reason): ${extractedAtNull}`);
  console.log(`  emailType IS NULL (superset — includes attempted-but-failed extractions too, per runExtraction's catch block): ${emailTypeNull}`);
  console.log(`  retailer IS NULL AND junkedAt IS NULL: ${retailerNullJunkedNull}`);
  console.log(`  orderId IS NULL AND extractedAt IS NULL (closest proxy to "no Haiku verdict recorded" — NOTE: there is no persisted per-email Haiku/isCommerceEmail verdict field anywhere in the schema; the Haiku classifier's result is used only in-line at ingestion to gate row creation and is never stored, so this variant cannot be queried directly — this is the nearest available proxy): ${noOrderNoExtractedAt}`);

  console.log("\n=== Re-intersecting each shape with food/grocery content match (subject/body), to confirm 3 is the right number for THAT specific intersection ===");
  const allEmails = await prisma.email.findMany({
    select: { id: true, subject: true, textBody: true, htmlBody: true, extractedAt: true, emailType: true, retailer: true, junkedAt: true, orderId: true },
  });
  let extractedAtNullAndContentMatch = 0;
  let emailTypeNullAndContentMatch = 0;
  for (const e of allEmails) {
    let bodyPlain = "";
    try { bodyPlain = e.textBody ? decrypt(e.textBody) : e.htmlBody ? decrypt(e.htmlBody) : ""; } catch { bodyPlain = ""; }
    const match = contentMatches(e.subject, bodyPlain);
    if (!match) continue;
    if (e.extractedAt == null) extractedAtNullAndContentMatch++;
    if (e.emailType == null) emailTypeNullAndContentMatch++;
  }
  console.log(`  extractedAt IS NULL AND food/grocery content match: ${extractedAtNullAndContentMatch}`);
  console.log(`  emailType IS NULL AND food/grocery content match: ${emailTypeNullAndContentMatch}`);
  console.log(`  (Confirms whether "3" is the whole universe for this intersection, or just the narrow subject-string query's slice of it.)`);

  console.log("\n=== Mechanical trace: full field dump of all 4 duplicate rows, including forwardType/anchorDate/anchorSource/needsReview ===");
  const dupeRows = await prisma.email.findMany({
    where: { subject: { contains: "Your Whole Foods Market order has been picked up" } },
    orderBy: { receivedAt: "asc" },
  });
  for (const e of dupeRows) {
    console.log(`\n  id: ${e.id}`);
    console.log(`  userId: ${e.userId}`);
    console.log(`  messageId: ${e.messageId ?? "null"}`);
    console.log(`  forwardType: ${e.forwardType ?? "null"}`);
    console.log(`  anchorDate: ${e.anchorDate?.toISOString() ?? "null"}`);
    console.log(`  anchorSource: ${e.anchorSource ?? "null"}`);
    console.log(`  retailer: ${e.retailer ?? "null"}`);
    console.log(`  emailType: ${e.emailType ?? "null"}`);
    console.log(`  needsReview: ${e.needsReview}`);
    console.log(`  junkedAt: ${e.junkedAt?.toISOString() ?? "null"}`);
    console.log(`  orderId: ${e.orderId ?? "null"}`);
    console.log(`  extractedAt: ${e.extractedAt?.toISOString() ?? "null"}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
  }

  // ==================== REQUEST 4 ====================
  console.log("\n\n########## 4. Content-based census — the query that should have run originally ##########\n");

  let rawContentMatchCount = 0;
  let rawStillLive = 0;
  let rawAlreadyJunked = 0;
  const byNameRaw = new Map<string, { total: number; live: number; junked: number }>();
  for (const name of FOOD_GROCERY_NAMES) byNameRaw.set(name, { total: 0, live: 0, junked: 0 });

  for (const e of allEmails) {
    let bodyPlain = "";
    try { bodyPlain = e.textBody ? decrypt(e.textBody) : e.htmlBody ? decrypt(e.htmlBody) : ""; } catch { bodyPlain = ""; }
    const match = contentMatches(e.subject, bodyPlain);
    if (!match) continue;
    rawContentMatchCount++;
    const bucket = byNameRaw.get(match)!;
    bucket.total++;
    if (e.junkedAt == null) {
      rawStillLive++;
      bucket.live++;
    } else {
      rawAlreadyJunked++;
      bucket.junked++;
    }
  }

  console.log(`Full raw count — Emails where subject OR body contains ANY enumerated name, case-insensitive, regardless of retailer/junkedAt: ${rawContentMatchCount}`);
  console.log(`  Already junked: ${rawAlreadyJunked}`);
  console.log(`  Still live (junkedAt null): ${rawStillLive}`);
  console.log("\nBreakdown by name:");
  for (const [name, { total, live, junked }] of byNameRaw) {
    if (total > 0) console.log(`  "${name}": ${total} total (${junked} junked, ${live} live)`);
  }

  console.log("\n=== Cross-reference against the retailer/domain-based census ===");
  console.log("Original Step 0 census (retailer field + sender domain), full history, combined matched: 11");
  console.log(`Content-based census (subject/body, any state): ${rawContentMatchCount}`);
  console.log(`Delta (content-based minus retailer/domain-based): ${rawContentMatchCount - 11}`);
  console.log("This delta includes BOTH genuine methodology misses AND keyword false positives (e.g. \"caviar\" matching Chan Luu product copy) — not yet separated in this raw count, per the request to report the full, unfiltered number first.");

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

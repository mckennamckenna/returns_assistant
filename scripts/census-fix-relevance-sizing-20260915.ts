// READ-ONLY sizing pass. Zero writes, zero billed Anthropic calls — pure
// DB reads + local date bucketing. Supports TASKS.md investigation:
// date-and-fix-relevance sizing across the 09-14 shortest-wins census's
// 131-row population (policySource='web_lookup' AND Email.lineItems empty).
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "../lib/amazonBundle";

const prisma = new PrismaClient();

function isEmptyLineItems(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Fixes plausibly relevant to body extraction, retailer resolution,
// lineItems parsing, policy-lookup gating, or the Amazon short-circuit.
// Dates are commit timestamps (America/Los_Angeles, per git log), used as
// the pre/post cutoff.
const FIXES = [
  {
    id: "F1",
    date: "2026-08-04",
    commit: "ae9e685",
    desc: 'Gate policy lookups off emailType="other"',
    outputChanging: true,
  },
  {
    id: "F2",
    date: "2026-08-09",
    commit: "fa28b1b",
    desc: "Amazon return-window default short-circuit (skip web_lookup for Amazon entirely)",
    outputChanging: true,
  },
  {
    id: "F3",
    date: "2026-08-19",
    commit: "b5434a0",
    desc: "Food + grocery delivery exclusion (skip web_lookup, junk instead)",
    outputChanging: true,
  },
  {
    id: "F4",
    date: "2026-08-23",
    commit: "efd4f43/c8c51e4",
    desc: "H&M two-pass retry — recovers orderNumber only, NOT lineItems yet",
    outputChanging: true,
  },
  {
    id: "F5",
    date: "2026-08-24",
    commit: "31525f5",
    desc: "Skip redundant lookupReturnPolicy when parent order's policy already resolved (changes whether policySource='web_lookup' fires at all)",
    outputChanging: true,
  },
  {
    id: "F6",
    date: "2026-08-25",
    commit: "a5a88d8",
    desc: "Zara/sender-fallback retailer resolution wired into runExtraction",
    outputChanging: true,
  },
  {
    id: "F7",
    date: "2026-09-06",
    commit: "534be8d",
    desc: "Retry widened to gap-fill lineItems/orderDate/orderTotal/returnWindowDays (not just orderNumber) — the actual lineItems-recovery mechanism for retailer-known rows",
    outputChanging: true,
  },
  {
    id: "F8",
    date: "2026-09-14",
    commit: "a24050b",
    desc: "runExtraction ordering fix — effectiveRetailer reaches lookup/Amazon/food-grocery gates earlier; does NOT touch the retry gate itself",
    outputChanging: true,
  },
  {
    id: "F9",
    date: "2026-09-15",
    commit: "60682ec",
    desc: "Option C — near-threshold-primary retry bypass (Bloomingdale's-shape)",
    outputChanging: true,
  },
];

// Commits reviewed on the same files but judged clearly not relevant to
// body extraction / retailer resolution / lineItems / policy-lookup
// gating / Amazon short-circuit (orderDate provenance, timezone display,
// carrier persistence, tracking-number parsing, shipment-merge candidate
// matching). Not bucketed below; listed for completeness per the
// non-goal-of-perfect-completeness instruction.
const REVIEWED_NOT_BUCKETED = [
  "c30c9fc (2026-09-05, tracking-number parsing via resolveBodyText — tracking field only, not lineItems/retailer/policy)",
  "d837b4e (2026-08-28, persist carrier on extraction write)",
  "c150170 / e03a99b (2026-08-27, orderDate provenance + timezone display)",
  "8d3d49e (2026-08-16, write-once orderDate)",
  "ce3e787 / 217a69f (2026-08-30/31, shipment-merge candidate matcher, unused)",
];

function fixCutoff(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59-07:00`);
}

async function main() {
  const rows = await prisma.email.findMany({
    where: { policySource: "web_lookup" },
    select: { id: true, retailer: true, lineItems: true, receivedAt: true, extractedAt: true, emailType: true },
  });

  const population = rows.filter((r) => isEmptyLineItems(r.lineItems));
  console.log(`=== Step 1: population ===`);
  console.log(`Total policySource='web_lookup': ${rows.length}`);
  console.log(`Empty lineItems: ${population.length} (expected ~131, drift OK)\n`);

  const missingExtractedAt = population.filter((r) => r.extractedAt == null);
  console.log(`=== Step 3: date proxy check ===`);
  console.log(`Rows with extractedAt populated: ${population.length - missingExtractedAt.length} / ${population.length}`);
  console.log(`Rows with extractedAt NULL (would need receivedAt fallback): ${missingExtractedAt.length}`);
  console.log(
    `NOTE: Email.extractedAt exists and is set on every runExtraction() call (success and failure branches) — a` +
      ` more direct signal than receivedAt for "when was this row last (re-)extracted," since a row can be received` +
      ` well before a fix ships but re-extracted (backfill, manual re-extract action) after it. Using extractedAt as` +
      ` primary, receivedAt as fallback for any null case, and reporting both bucketings where they'd diverge` +
      ` materially.\n`,
  );

  console.log(`=== Step 2: fixes considered ===`);
  for (const f of FIXES) {
    console.log(`  ${f.id}  ${f.date}  ${f.commit}  ${f.desc}`);
  }
  console.log(`\nReviewed, judged not relevant to this population's mechanism, not bucketed:`);
  for (const r of REVIEWED_NOT_BUCKETED) console.log(`  - ${r}`);
  console.log();

  function bucket(dateField: "extractedAt" | "receivedAt") {
    console.log(`\n=== Step 4: fix x pre/post (by ${dateField}) ===`);
    for (const f of FIXES) {
      const cutoff = fixCutoff(f.date);
      let pre = 0;
      let post = 0;
      let missing = 0;
      for (const r of population) {
        const d = r[dateField] ?? (dateField === "extractedAt" ? r.receivedAt : null);
        if (d == null) {
          missing++;
          continue;
        }
        if (d < cutoff) pre++;
        else post++;
      }
      console.log(`  ${f.id} (${f.date}): pre=${pre}  post=${post}${missing ? `  missing=${missing}` : ""}`);
    }
  }

  bucket("extractedAt");

  // Step 5: retailer-group cross-cut.
  const AMAZON_NAMES = new Set(["Amazon", "Amazon Fresh"]);
  function retailerGroup(retailer: string | null): string {
    if (retailer && AMAZON_NAMES.has(retailer)) return "Amazon";
    if (retailer === "Bloomingdale's") return "Bloomingdale's";
    return "other"; // split into top-5-remaining vs long-tail below
  }

  const byGroup = new Map<string, typeof population>();
  for (const r of population) {
    const g = retailerGroup(r.retailer);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(r);
  }

  // Determine top-5-after-Amazon/Bloomingdale's among "other".
  const otherRows = byGroup.get("other") ?? [];
  const otherByRetailer = new Map<string, typeof population>();
  for (const r of otherRows) {
    const key = r.retailer ?? "(null)";
    if (!otherByRetailer.has(key)) otherByRetailer.set(key, []);
    otherByRetailer.get(key)!.push(r);
  }
  const sortedOther = [...otherByRetailer.entries()].sort((a, b) => b[1].length - a[1].length);
  const top5 = sortedOther.slice(0, 5);
  const tail = sortedOther.slice(5);
  const top5Rows = top5.flatMap(([, rs]) => rs);
  const tailRows = tail.flatMap(([, rs]) => rs);

  console.log(`\n=== Step 5: retailer-group x fix x pre/post ===`);
  console.log(`Groups: Amazon (${(byGroup.get("Amazon") ?? []).length}), Bloomingdale's (${(byGroup.get("Bloomingdale's") ?? []).length}), top-5-other (${top5Rows.length}: ${top5.map(([k, rs]) => `${k}=${rs.length}`).join(", ")}), long-tail (${tailRows.length} across ${tail.length} retailers)`);

  const groups: [string, typeof population][] = [
    ["Amazon", byGroup.get("Amazon") ?? []],
    ["Bloomingdale's", byGroup.get("Bloomingdale's") ?? []],
    ["top-5-other", top5Rows],
    ["long-tail", tailRows],
  ];

  for (const [groupName, groupRows] of groups) {
    console.log(`\n  -- ${groupName} (n=${groupRows.length}) --`);
    for (const f of FIXES) {
      const cutoff = fixCutoff(f.date);
      let pre = 0;
      let post = 0;
      for (const r of groupRows) {
        const d = r.extractedAt ?? r.receivedAt;
        if (d < cutoff) pre++;
        else post++;
      }
      console.log(`    ${f.id} (${f.date}): pre=${pre}  post=${post}`);
    }
  }

  // Step 6: post-ALL-fixes hot cell.
  console.log(`\n=== Step 6: post-ALL-relevant-fixes subset ("hot cell") ===`);
  const latestCutoff = fixCutoff(FIXES[FIXES.length - 1].date);
  const postAll = population.filter((r) => (r.extractedAt ?? r.receivedAt) >= latestCutoff);
  console.log(`Rows post-ALL fixes (extractedAt/receivedAt >= ${FIXES[FIXES.length - 1].date}): ${postAll.length}`);

  const postAllByRetailer = new Map<string, number>();
  for (const r of postAll) {
    const key = r.retailer ?? "(null)";
    postAllByRetailer.set(key, (postAllByRetailer.get(key) ?? 0) + 1);
  }
  console.log(`Retailer breakdown:`);
  for (const [retailer, count] of [...postAllByRetailer.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${retailer}: ${count}`);
  }

  console.log(`\nreceivedAt distribution of post-all-fixes subset:`);
  for (const r of postAll.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())) {
    console.log(`  ${r.id}  retailer=${r.retailer}  receivedAt=${r.receivedAt.toISOString().slice(0, 10)}  extractedAt=${r.extractedAt?.toISOString().slice(0, 10) ?? "(null)"}  emailType=${r.emailType}`);
  }

  // Also report against F9 specifically (the most recent/narrowest fix,
  // Option C) since that's the fix most people would expect to have
  // closed the gap for Bloomingdale's-shape rows specifically.
  console.log(`\n=== Also: pre/post F9 (Option C, 2026-09-15) only, retailer breakdown ===`);
  const f9Cutoff = fixCutoff("2026-09-15");
  const postF9 = population.filter((r) => (r.extractedAt ?? r.receivedAt) >= f9Cutoff);
  const preF9 = population.filter((r) => (r.extractedAt ?? r.receivedAt) < f9Cutoff);
  console.log(`pre-F9: ${preF9.length}  post-F9: ${postF9.length}`);

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

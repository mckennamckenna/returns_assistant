// PHASE A census for the Aug 1–4 credit-outage re-extraction backfill
// (TASKS.md, 2026-08-04). READ-ONLY — no writes, no Anthropic calls.
// Does not import runExtraction/extractEmail at all, by design, so this
// script cannot accidentally bill anything.
//
// Usage: npx tsx scripts/census-aug-outage-orphans.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OUTAGE_START = new Date("2026-08-01T12:08:00.000Z");

async function main() {
  console.log("PHASE A — READ ONLY. Zero writes, zero Anthropic calls.\n");
  console.log(`Outage lower bound: ${OUTAGE_START.toISOString()}\n`);

  // Ran extraction, it failed (runExtraction's catch block: emailType
  // stays null, extractedAt gets set to the failure timestamp).
  const ranAndFailed = await prisma.email.findMany({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: null, extractedAt: { not: null } },
    select: { id: true, receivedAt: true, orderId: true, subject: true, needsReview: true },
    orderBy: { receivedAt: "asc" },
  });

  // Never reached either the success path or the catch block's own write —
  // extractedAt itself is still null. Distinct population per the brief.
  const neverRun = await prisma.email.findMany({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: null, extractedAt: null },
    select: { id: true, receivedAt: true, orderId: true, subject: true, needsReview: true },
    orderBy: { receivedAt: "asc" },
  });

  const target = [...ranAndFailed, ...neverRun];

  console.log(`Ran and failed (emailType: null, extractedAt set): ${ranAndFailed.length}`);
  console.log(`Never run at all (emailType: null, extractedAt: null): ${neverRun.length}`);
  console.log(`TOTAL TARGET SET: ${target.length}\n`);

  const linkedButFailed = target.filter((e) => e.orderId !== null);
  console.log(`Of the target set, already linked to an order despite emailType:null: ${linkedButFailed.length} (expect 0 — failure path never calls linkEmailToOrder)\n`);

  // Healthy extractions in the same window, for contrast — confirms the
  // failure-state filter is actually selecting a subset, not everything.
  const healthyInWindow = await prisma.email.count({
    where: { receivedAt: { gte: OUTAGE_START }, emailType: { not: null } },
  });
  console.log(`For contrast — emails in the same window that extracted fine (emailType set): ${healthyInWindow}\n`);

  // Sanity check: is the earlier July outage window now genuinely clear?
  const julyStragglers = await prisma.email.findMany({
    where: { receivedAt: { lt: OUTAGE_START }, emailType: null },
    select: { id: true, receivedAt: true },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`July-outage-or-earlier stragglers still emailType:null (receivedAt < ${OUTAGE_START.toISOString()}): ${julyStragglers.length}`);
  if (julyStragglers.length > 0) {
    for (const s of julyStragglers) console.log(`  STRAGGLER: ${s.id} (${s.receivedAt.toISOString()})`);
  }
  console.log();

  console.log("=== TARGET SET DETAIL ===");
  for (const e of target) {
    console.log(`${e.id} | ${e.receivedAt.toISOString()} | orderId=${e.orderId ?? "null"} | needsReview=${e.needsReview}`);
  }

  if (target.length === 0) {
    console.log("\nNothing to re-extract — target set is empty.");
    return;
  }

  if (target.length > 500) {
    console.log(`\n⚠️  SANITY CHECK FAILED: ${target.length} is implausibly large for a 3-day outage window. STOPPING — do not proceed to a cost estimate or Phase B. The query is likely catching non-outage emails.`);
    return;
  }

  // Cost estimate — cannot know in advance which rows will resolve a
  // retailer with no in-email window (that requires calling the model),
  // so extrapolate from the 2026-07-26 precedent: 16/23 (~70%) of that
  // repair's rows triggered a lookupReturnPolicy call. Flagged explicitly
  // as an estimate based on precedent, not a guarantee.
  const PRECEDENT_LOOKUP_RATE = 16 / 23;
  const estimatedExtractionCalls = target.length;
  const estimatedLookupCalls = Math.round(target.length * PRECEDENT_LOOKUP_RATE);
  const estimatedTotalCalls = estimatedExtractionCalls + estimatedLookupCalls;

  // Rough $ figure — Sonnet extraction + Sonnet lookup (with up to 3 web
  // searches each) are the two paid call shapes here; classifier (Haiku)
  // is not re-run by runExtraction. Order-of-magnitude only.
  const ROUGH_DOLLARS_PER_EXTRACTION = 0.03; // Sonnet, ~2-4k input tokens, short output
  const ROUGH_DOLLARS_PER_LOOKUP = 0.05; // Sonnet + up to 3 web searches
  const roughDollarEstimate =
    estimatedExtractionCalls * ROUGH_DOLLARS_PER_EXTRACTION + estimatedLookupCalls * ROUGH_DOLLARS_PER_LOOKUP;

  console.log("\n=== COST ESTIMATE (no calls made) ===");
  console.log(`Extraction calls (1 per email): ${estimatedExtractionCalls}`);
  console.log(`Estimated policy-lookup calls (~${Math.round(PRECEDENT_LOOKUP_RATE * 100)}% of rows, per 2026-07-26 precedent — NO CACHE EXISTS YET, so repeat retailers each bill a fresh lookup): ${estimatedLookupCalls}`);
  console.log(`Estimated total billed calls: ${estimatedTotalCalls}`);
  console.log(`Rough dollar estimate: ~$${roughDollarEstimate.toFixed(2)} (order of magnitude only)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

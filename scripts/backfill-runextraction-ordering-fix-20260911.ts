// Backfill for the runExtraction-ordering fix (TASKS.md 🔴 Now, code fix
// shipped `a24050b` 2026-09-14, diagnosed in the Zara #54858811380 session,
// TASKS.md ✅ Done 2026-09-11). The fix only changes behavior for emails
// extracted from now on — it does not retroactively touch Order/Email rows
// that were already written under the old (buggy) ordering. This script
// re-extracts the specific email that caused each affected order's gap, so
// the now-fixed lookupReturnPolicy gate gets a chance to fire.
//
// Bug-signature match, not the whole "returnDeadline/returnWindowDays null"
// population: an order only benefits from this fix if the reason its
// return policy is unresolved is THIS bug -- i.e. at least one of its
// linked emails has retailerSource: "sender_fallback" (body extraction
// returned null, sender fallback resolved a real retailer, but the OLD
// ordering meant that resolution came too late to unlock the lookup gate).
// An order with retailer/orderNumber present but returnWindowDays/
// returnDeadline null for some OTHER reason (a genuine web-lookup miss, a
// retry-worthy extraction gap, etc.) does NOT match this bug and is
// deliberately excluded -- re-extracting it wouldn't be testing THIS fix,
// and would be an unscoped billed call. Excluded orders are listed, not
// silently dropped.
//
// Re-extraction target per matching order: the earliest-received linked
// email with retailerSource: "sender_fallback" -- re-running runExtraction
// on that one email is enough to re-trigger the lookup for the order (the
// widened 2026-08-24 skip means only one email per order ever needs to hit
// the billed branch; re-extracting every sibling email would be redundant,
// unscoped billed cost).
//
// DRY RUN (default) makes ZERO Anthropic calls, unlike this repo's
// backfill-refund-status.ts precedent (which calls extractEmail() live to
// preview) -- the session prompt for this backfill specifically requires
// Gate 4 to be zero-billed. Instead, dry run PREDICTS the outcome purely
// from each candidate order/email's currently-stored fields: the target
// email's already-resolved `retailer` (persisted by the OLD code's
// post-hoc fallback write, which ran regardless of the lookup-gate bug)
// is used to simulate isAmazonOrder / isFoodGroceryRetailer routing ahead
// of time, without calling either lookupReturnPolicy or extractEmailIdentity.
//
// --apply reuses runExtraction() directly (same precedent as
// backfill-refund-status.ts and pm-reextract-hm-target-row.ts) rather than
// duplicating its logic -- it already re-extracts, re-applies the fixed
// gate ordering, and re-links/re-derives status in one call.
//
// Usage:
//   npx tsx scripts/backfill-runextraction-ordering-fix-20260911.ts          # dry run
//   npx tsx scripts/backfill-runextraction-ordering-fix-20260911.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { isFoodGroceryRetailer } from "@/lib/foodGroceryExclusion";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Carries the dry run's billed-call estimate forward to the --apply run
// (separate process invocations) so the 10%-ceiling check below has
// something to check against. Gitignored (.scratch/), deleted after use --
// not a durable artifact, just a handoff between two runs of this script
// in the same backfill session.
const CEILING_CACHE_PATH = ".scratch/runextraction-ordering-fix-dryrun-estimate.json";

// Friday night's (2026-09-11) Trace 5 census, as recorded in TASKS.md/
// HISTORY.md -- retailer name -> count. No per-order IDs were persisted
// (the diagnostic script was a throwaway, deleted after use per repo
// convention), so re-verification below can only compare against this
// count/retailer-breakdown snapshot, not exact row identity. Flagged
// explicitly in the report rather than silently assumed unchanged.
const FRIDAY_SNAPSHOT: Record<string, number> = {
  "ACE VISALIA RSC": 1,
  "Anthropic PBC": 1,
  "Bloomingdale's": 2,
  Etsy: 1,
  "Five Marys Ranch": 1,
  Nordstrom: 2,
  "Rowing Pad": 1,
  SCRIBE: 1,
  Shutterfly: 1,
  "VPL Bike": 1,
  Zara: 1,
  nmjlmajong: 1,
  "row works clothing": 1,
};
const FRIDAY_TOTAL = Object.values(FRIDAY_SNAPSHOT).reduce((a, b) => a + b, 0); // 15

type CandidateEmail = {
  id: string;
  retailer: string | null;
  retailerSource: string | null;
  emailType: string | null;
  receivedAt: Date;
};

function predictRouting(effectiveRetailer: string | null): {
  route: "amazon_default" | "food_grocery_exclusion" | "general_lookup";
  predictedBilledCalls: number; // for the lookupReturnPolicy step specifically
} {
  if (isAmazonOrder(effectiveRetailer)) return { route: "amazon_default", predictedBilledCalls: 0 };
  if (isFoodGroceryRetailer(effectiveRetailer)) return { route: "food_grocery_exclusion", predictedBilledCalls: 0 };
  return { route: "general_lookup", predictedBilledCalls: 1 };
}

async function main() {
  console.log(APPLY ? "MODE: APPLYING" : "MODE: DRY RUN — zero Anthropic calls, nothing will be changed");
  console.log();

  // Re-verify against production BEFORE any action -- same query shape as
  // Friday's Trace 5 census.
  const currentOrders = await prisma.order.findMany({
    where: {
      retailer: { not: null },
      orderNumber: { not: null },
      returnDeadline: null,
      returnWindowDays: null,
    },
    select: {
      id: true,
      retailer: true,
      orderNumber: true,
      returnDeadline: true,
      returnWindowDays: true,
      needsReview: true,
      archivedAt: true,
      deletedAt: true,
      emails: {
        select: { id: true, retailer: true, retailerSource: true, emailType: true, receivedAt: true },
        orderBy: { receivedAt: "asc" },
      },
    },
  });

  const currentTotal = currentOrders.length;
  const currentByRetailer: Record<string, number> = {};
  for (const o of currentOrders) {
    const k = o.retailer ?? "(null)";
    currentByRetailer[k] = (currentByRetailer[k] ?? 0) + 1;
  }

  console.log("=== Re-verification against Friday 2026-09-11's census ===");
  console.log(`Friday total: ${FRIDAY_TOTAL}   Current total: ${currentTotal}`);
  console.log("Friday breakdown:", JSON.stringify(FRIDAY_SNAPSHOT));
  console.log("Current breakdown:", JSON.stringify(currentByRetailer));

  const allRetailers = new Set([...Object.keys(FRIDAY_SNAPSHOT), ...Object.keys(currentByRetailer)]);
  const diffLines: string[] = [];
  for (const r of allRetailers) {
    const before = FRIDAY_SNAPSHOT[r] ?? 0;
    const after = currentByRetailer[r] ?? 0;
    if (before !== after) diffLines.push(`  ${r}: ${before} -> ${after}`);
  }
  if (diffLines.length > 0) {
    console.log("DELTA vs Friday (per retailer):");
    console.log(diffLines.join("\n"));
  } else {
    console.log("No per-retailer delta vs Friday's breakdown.");
  }

  const pctDelta = FRIDAY_TOTAL === 0 ? Infinity : Math.abs(currentTotal - FRIDAY_TOTAL) / FRIDAY_TOTAL;
  const MATERIAL_THRESHOLD = 0.5; // >50% swing either way counts as "materially shifted" for this reconciliation
  if (pctDelta > MATERIAL_THRESHOLD) {
    console.log(
      `\n⚠ Population has shifted materially vs Friday (${currentTotal} vs ${FRIDAY_TOTAL}, ${(pctDelta * 100).toFixed(0)}% swing). ` +
        `Note: exact row-level identity cannot be verified either way -- Friday's diagnostic script was a throwaway, deleted after use per ` +
        `repo convention, and only the retailer/count breakdown was persisted to TASKS.md/HISTORY.md. Stopping short of a recommendation; ` +
        `owner reconciliation needed before proceeding.`,
    );
    await prisma.$disconnect();
    return;
  }
  console.log(
    `\nPopulation size is consistent with Friday's snapshot (within ${(MATERIAL_THRESHOLD * 100).toFixed(0)}%). ` +
      `Proceeding on retailer/count-breakdown match -- exact row identity was never persisted from Friday's run, so this is the ` +
      `strongest verification available.\n`,
  );

  // 10% billed-call ceiling: --apply must not proceed with any write until
  // its own freshly-computed estimate is checked against the dry run's.
  // Computed here (before the per-order loop starts any writes) rather
  // than after, so a blown ceiling aborts with zero calls made.
  let cachedDryRunEstimate: number | null = null;
  if (APPLY) {
    if (!existsSync(CEILING_CACHE_PATH)) {
      console.log(
        `\n⚠ No dry-run estimate found at ${CEILING_CACHE_PATH}. Run this script WITHOUT --apply first -- the 10% billed-call ceiling has ` +
          `nothing to check against otherwise. Aborting, zero calls made.`,
      );
      await prisma.$disconnect();
      return;
    }
    const cached = JSON.parse(readFileSync(CEILING_CACHE_PATH, "utf-8"));
    cachedDryRunEstimate = cached.totalPredictedBilledCalls;
    console.log(`Loaded dry-run estimate from ${CEILING_CACHE_PATH}: ${cachedDryRunEstimate} billed calls (generated ${cached.generatedAt}).`);
  }

  // --- PASS 1: pure prediction, read-only, zero Anthropic calls, no writes ---
  // Runs identically in dry-run and --apply -- the ceiling check below needs
  // this pass's total BEFORE any write is allowed to happen.
  console.log("=== Per-order breakdown ===\n");

  type MatchedOrder = { order: (typeof currentOrders)[number]; target: CandidateEmail; totalForThisOrder: number };
  const matched: MatchedOrder[] = [];
  let excludedCount = 0;
  let skippedArchivedOrDeleted = 0;

  for (const order of currentOrders) {
    console.log(`Order ${order.id}  ${order.retailer} #${order.orderNumber}`);
    console.log(
      `  current: retailer=${order.retailer}  returnPolicy(returnWindowDays)=${order.returnWindowDays}  returnDeadline=${order.returnDeadline}  needsReview=${order.needsReview}`,
    );

    if (order.archivedAt || order.deletedAt) {
      console.log(`  SKIPPED — archived/deleted since Friday (archivedAt=${order.archivedAt}, deletedAt=${order.deletedAt}). Not touched.`);
      skippedArchivedOrDeleted++;
      console.log();
      continue;
    }

    const candidates = order.emails.filter((e): e is CandidateEmail => e.retailerSource === "sender_fallback");

    if (candidates.length === 0) {
      console.log(
        `  EXCLUDED — no linked email has retailerSource: "sender_fallback". This order's null returnPolicy/returnDeadline is NOT ` +
          `explained by tonight's bug signature; re-extracting it wouldn't be testing this fix. Needs separate diagnosis, out of scope here.`,
      );
      excludedCount++;
      console.log();
      continue;
    }

    const target = candidates[0]; // earliest receivedAt, already sorted
    const { route, predictedBilledCalls } = predictRouting(target.retailer);
    const totalForThisOrder = 1 + predictedBilledCalls; // 1 = extractEmailIdentity, always incurred by runExtraction()

    console.log(`  MATCHES bug signature. Target email: ${target.id} (received ${target.receivedAt.toISOString()}, emailType=${target.emailType})`);
    console.log(`  effectiveRetailer under the fix: "${target.retailer}"  ->  predicted route: ${route}`);
    console.log(
      `  predicted change: returnWindowDays/returnWindowStartsFrom/returnDeadline/policySource would populate ` +
        `(route=${route}${route === "general_lookup" ? ", pending real lookupReturnPolicy result -- may also come back 'unclear' and stay null" : ""}); needsReview would likely clear if a deadline resolves.`,
    );
    console.log(`  predicted billed calls for this order: ${totalForThisOrder} (1 extractEmailIdentity${predictedBilledCalls ? " + 1 lookupReturnPolicy" : ""})`);
    console.log();

    matched.push({ order, target, totalForThisOrder });
  }

  const totalPredictedBilledCalls = matched.reduce((sum, m) => sum + m.totalForThisOrder, 0);

  console.log("=== Summary (prediction pass) ===");
  console.log(`Total orders re-verified: ${currentTotal}`);
  console.log(`  Matching bug signature (candidates for this backfill): ${matched.length}`);
  console.log(`  Excluded (different root cause, not this bug): ${excludedCount}`);
  console.log(`  Skipped (archived/deleted since Friday): ${skippedArchivedOrDeleted}`);
  console.log(`Predicted total billed calls: ${totalPredictedBilledCalls}\n`);

  if (!APPLY) {
    mkdirSync(".scratch", { recursive: true });
    writeFileSync(
      CEILING_CACHE_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), totalPredictedBilledCalls, matchingOrderIds: matched.map((m) => m.order.id) }, null, 2),
    );
    console.log(`Dry run complete. Estimate cached to ${CEILING_CACHE_PATH} for the --apply run's ceiling check.`);
    console.log(`Re-run with --apply to execute. Real-run ceiling: this estimate + 10% = ${Math.ceil(totalPredictedBilledCalls * 1.1)} calls.`);
    return;
  }

  // --- Ceiling check: must pass BEFORE pass 2 makes any writes ---
  const ceiling = Math.ceil((cachedDryRunEstimate ?? 0) * 1.1);
  console.log(`Ceiling check: live estimate ${totalPredictedBilledCalls} vs dry-run-based ceiling ${ceiling} (dry run ${cachedDryRunEstimate} + 10%).`);
  if (totalPredictedBilledCalls > ceiling) {
    console.log(
      `\n⚠ ABORTING — live estimate (${totalPredictedBilledCalls}) exceeds the dry run's ceiling (${ceiling}). Population grew more than 10% ` +
        `since the dry run. Zero calls made. Re-run the dry run to get a fresh baseline, then reconcile with the owner before retrying --apply.`,
    );
    return;
  }
  console.log(`Ceiling check passed. Proceeding with ${matched.length} order(s).\n`);

  // --- PASS 2: writes, --apply only ---
  console.log("=== Applying ===\n");
  let appliedCount = 0;
  let skippedAtWriteTime = 0;
  let failedCount = 0;

  for (const { order, target } of matched) {
    console.log(`Order ${order.id}  ${order.retailer} #${order.orderNumber}  target email ${target.id}`);

    // Read-verify gate: re-read this ONE order fresh, immediately before
    // writing, in case its state drifted between pass 1 and now.
    const fresh = await prisma.order.findUnique({
      where: { id: order.id },
      select: { returnWindowDays: true, returnDeadline: true, archivedAt: true, deletedAt: true },
    });
    if (!fresh || fresh.archivedAt || fresh.deletedAt) {
      console.log(`  SKIPPED AT WRITE TIME — order archived/deleted/missing since the prediction pass.`);
      skippedAtWriteTime++;
      console.log();
      continue;
    }
    if (fresh.returnWindowDays != null || fresh.returnDeadline != null) {
      console.log(`  SKIPPED AT WRITE TIME — returnWindowDays/returnDeadline no longer null (resolved by something else since the prediction pass).`);
      skippedAtWriteTime++;
      console.log();
      continue;
    }

    try {
      await runExtraction(target.id);
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      console.log(
        `  APPLIED → returnWindowDays=${updatedOrder?.returnWindowDays}  returnDeadline=${updatedOrder?.returnDeadline}  ` +
          `policySource=${updatedOrder?.policySource}  needsReview=${updatedOrder?.needsReview}`,
      );
      appliedCount++;
    } catch (err) {
      console.log(`  FAILED — ${(err as Error).message}. Continuing with remaining orders.`);
      failedCount++;
    }
    console.log();
  }

  console.log("=== Summary (apply pass) ===");
  console.log(`Applied: ${appliedCount}  Skipped at write time: ${skippedAtWriteTime}  Failed: ${failedCount}`);
  console.log(`\nDone applying.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

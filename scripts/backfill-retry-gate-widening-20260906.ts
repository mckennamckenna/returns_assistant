// Backfill for the retry-trigger predicate widening (TASKS.md 🔴 Now,
// 2026-09-06 — see docs/audits/2026-09-06-gap-extraction-diagnostic.md,
// 2026-09-06-retry-trigger-blast-radius-census.md,
// 2026-09-06-gap-inc-spot-check.md).
//
// Scoped to exactly the 4 Gap order_confirmation rows confirmed by
// scripts/audits/2026-09-06-retry-fix-backfill-count.ts (owner exclusions
// for Amazon/Amazon Haul/Whole Foods Market/Monos baked into that script's
// query, not re-derived here — this script takes the confirmed id list
// directly so there's no risk of the two predicates drifting apart).
//
// Usage: npx tsx scripts/backfill-retry-gate-widening-20260906.ts
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "../lib/runExtraction";

const prisma = new PrismaClient();

// Confirmed via scripts/audits/2026-09-06-retry-fix-backfill-count.ts —
// exactly these 4 ids matched the corrected predicate with exclusions applied.
const TARGET_IDS = [
  "cmt9hlpmr0001jo04iy10dzxc",
  "cmtkedq300001le04347677sj",
  "cmt4mpgs90001jt042ey0gtgf",
  "cmsx8n2a90001jl04uxg16s99",
];

async function main() {
  for (const id of TARGET_IDS) {
    const before = await prisma.email.findUnique({
      where: { id },
      select: { id: true, retailer: true, orderNumber: true, orderDate: true, orderTotal: true, lineItems: true, returnWindowDays: true, needsReview: true, extractionNotes: true },
    });

    if (!before) {
      console.log(`\n${id}: NOT FOUND — skipping`);
      continue;
    }

    await runExtraction(before.id);

    const after = await prisma.email.findUnique({
      where: { id },
      select: { retailer: true, orderNumber: true, orderDate: true, orderTotal: true, lineItems: true, returnWindowDays: true, needsReview: true, extractionNotes: true },
    });

    const filledFieldsMatch = after?.extractionNotes?.match(/Fields recovered from alternate body source on retry: ([^.]+)\./);
    const filledFields = filledFieldsMatch ? filledFieldsMatch[1] : "(none — retry did not gap-fill any field)";

    console.log(`\n--- ${id} (${before.retailer}) ---`);
    console.log(`  filledFields: ${filledFields}`);
    console.log(`  needsReview: ${before.needsReview} -> ${after?.needsReview}`);
    console.log(`  orderDate: ${before.orderDate ?? "null"} -> ${after?.orderDate ?? "null"}`);
    console.log(`  orderTotal: ${before.orderTotal ?? "null"} -> ${after?.orderTotal ?? "null"}`);
    console.log(`  returnWindowDays: ${before.returnWindowDays ?? "null"} -> ${after?.returnWindowDays ?? "null"}`);
    console.log(`  lineItems count: ${Array.isArray(before.lineItems) ? before.lineItems.length : 0} -> ${Array.isArray(after?.lineItems) ? (after!.lineItems as unknown[]).length : 0}`);
  }

  console.log(`\nDone. Reprocessed ${TARGET_IDS.length} row(s).`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

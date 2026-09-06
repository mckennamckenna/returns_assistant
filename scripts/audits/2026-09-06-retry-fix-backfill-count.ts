// Backfill scoping query (TASKS.md 🔴 Now, retry-trigger fix, 2026-09-06):
// corrected mechanism-fingerprint predicate per the Gap Inc. spot-check
// (docs/audits/2026-09-06-gap-inc-spot-check.md) — drops the census's
// `returnWindowDays IS NULL` condition, since that field is routinely
// populated by the independent web-search policy lookup even when the
// body-extraction mechanism has completely failed, masking otherwise-
// affected rows from the original census's predicate.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Reports matched count
// and retailer distribution only — no reprocessing. That is a separate,
// gated step run only after owner confirmation.
//
// Owner exclusions (2026-09-06, baked into the WHERE clause so they're
// durable in code, not just a one-time instruction):
// - Amazon, Amazon Haul: Amazon is bound to the AMAZON_HANDLING.md spec
//   pass (2026-07-19 decision) — general-purpose fixes shouldn't touch
//   Amazon rows outside that spec work.
// - Whole Foods Market: grocery is being blocked going forward as a policy
//   call; also this specific row was already established by the prior
//   spot-check as a different-cause no-op, not the confirmed mechanism.
// - Monos: needsReview=true here disagrees with the order's Kept/Archive
//   state in the app UI — possibly the known "manually-created
//   null-orderNumber orders" duplicate bug (TASKS.md ~line 1839) or a
//   state-sync issue. "Safe reprocess" assumes the row is what we think it
//   is; that assumption doesn't hold here. Not investigated this session —
//   owner will decide whether it warrants its own item.
//
// Usage: npx tsx scripts/audits/2026-09-06-retry-fix-backfill-count.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXCLUDED_RETAILERS = ["Amazon", "Amazon Haul", "Whole Foods Market", "Monos"];

async function main() {
  const baseline = await prisma.email.count({
    where: { emailType: "order_confirmation" },
  });

  const candidates = await prisma.email.findMany({
    where: {
      emailType: "order_confirmation",
      orderNumber: { not: null },
      orderDate: null,
      orderTotal: null,
      retailer: { notIn: EXCLUDED_RETAILERS },
    },
    select: {
      id: true,
      retailer: true,
      needsReview: true,
      lineItems: true,
    },
  });

  const matched = candidates.filter((c) => {
    const li = c.lineItems;
    return li == null || (Array.isArray(li) && li.length === 0);
  });

  console.log(`Baseline population (emailType=order_confirmation): ${baseline}`);
  console.log(
    `Matched rows (orderNumber present, orderDate/orderTotal/lineItems null, returnWindowDays condition dropped): ${matched.length}`,
  );

  const byRetailer = new Map<string, number>();
  for (const m of matched) {
    const key = m.retailer ?? "(null)";
    byRetailer.set(key, (byRetailer.get(key) ?? 0) + 1);
  }
  console.log("\nRetailer breakdown (matched set):");
  for (const [retailer, count] of [...byRetailer.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${retailer}: ${count}`);
  }

  const flagged = matched.filter((m) => m.needsReview);
  const silent = matched.filter((m) => !m.needsReview);
  console.log(`\nneedsReview=true (flagged): ${flagged.length}`);
  console.log(`needsReview=false (silent slice): ${silent.length}`);

  console.log(`\nEstimated model calls if all matched rows are reprocessed: ${matched.length} (one retry-pass call per row, "email_extraction_retry" — reprocessing itself also re-runs the primary "email_extraction" pass per row, so worst case is ${matched.length * 2} calls per row if the primary pass is also re-run; confirm reprocessing approach before backfill).`);
  console.log("\nIds (for backfill step, not run here):");
  for (const m of matched) {
    console.log(`  ${m.id} (${m.retailer ?? "(null)"})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

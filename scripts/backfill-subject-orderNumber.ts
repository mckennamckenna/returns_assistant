// Backfill: re-run extraction on Email rows where orderNumber IS NULL and
// needsReview = true. These were flagged before the extraction prompt learned
// to read the subject line for the order number (e.g. Proenza Schouler shipping
// emails whose subject says "A shipment from order #86864 is on the way" but
// whose body never repeats the number).
//
// Usage:
//   npx tsx scripts/backfill-subject-orderNumber.ts          # dry run
//   npx tsx scripts/backfill-subject-orderNumber.ts --apply  # re-extract
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING — re-extracting rows");
  console.log();

  const rows = await prisma.email.findMany({
    where: { orderNumber: null, needsReview: true },
    select: { id: true, subject: true, retailer: true, emailType: true, userId: true },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Found ${rows.length} Email row(s) with orderNumber = null AND needsReview = true\n`);

  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  console.log("Rows that would be re-extracted:");
  for (const r of rows) {
    console.log(`  id=${r.id}`);
    console.log(`    subject:   ${r.subject ?? "(none)"}`);
    console.log(`    retailer:  ${r.retailer ?? "(none)"}`);
    console.log(`    emailType: ${r.emailType ?? "(unset)"}`);
    console.log();
  }

  if (DRY_RUN) {
    console.log("Dry run complete. If the count and subjects look right, run with --apply.");
    return;
  }

  let fixed = 0;
  let stillNeeds = 0;

  for (const r of rows) {
    console.log(`Re-extracting ${r.id} (subject: "${r.subject ?? "(none)"}")…`);
    await runExtraction(r.id);

    const updated = await prisma.email.findUnique({
      where: { id: r.id },
      select: { orderNumber: true, needsReview: true },
    });

    if (updated?.orderNumber) {
      console.log(`  ✓ orderNumber now: ${updated.orderNumber} | needsReview: ${updated.needsReview}`);
      fixed++;
    } else {
      console.log(`  ✗ orderNumber still null | needsReview: ${updated?.needsReview}`);
      stillNeeds++;
    }
    console.log();
  }

  console.log(`Done. ${fixed} row(s) now have an order number; ${stillNeeds} still don't.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

// One-time backfill after improving the extraction prompt (more
// aggressive orderTotal/lineItems/orderDate/returnPortalUrl extraction
// from shipping & delivery confirmations specifically) — re-runs
// extraction on every existing email so past forwards benefit from the
// prompt improvement, not just new ones. Safe to re-run: runExtraction's
// merge logic is additive (a re-extraction that finds less than before
// never erases what an order already has — see lib/linkOrder.ts's
// mergeEmailIntoOrder).
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/reextract-all-emails.ts

import { PrismaClient } from "@prisma/client";
import { runExtraction } from "../lib/runExtraction";

const prisma = new PrismaClient();

async function main() {
  const emails = await prisma.email.findMany({ select: { id: true, subject: true } });
  console.log(`Re-extracting ${emails.length} emails...`);

  for (const email of emails) {
    console.log(`- ${email.id} (${email.subject ?? "no subject"})`);
    await runExtraction(email.id);
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

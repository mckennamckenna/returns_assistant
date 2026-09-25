// Checkpoint 3 verification harness (2026-09-25): re-extract ONE email via
// the exact code path production's Re-extract action uses
// (app/(app)/emails/[id]/actions.ts -> runExtraction). Read-mostly: the only
// writes are extraction's own, which is the point. Billed: up to 3 calls per
// email (primary extraction + alternate-body pass + policy lookup).
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "../lib/runExtraction";
const prisma = new PrismaClient();
const ID = process.argv[2];
const d = (x: Date | null | undefined) => (x ? x.toISOString().replace("T", " ").slice(0, 19) + "Z" : "—");

async function snap(label: string) {
  const e = await prisma.email.findUnique({
    where: { id: ID },
    select: { extractedAt: true, emailType: true, retailer: true, orderNumber: true, orderId: true,
              needsReview: true, confidence: true, returnWindowDays: true, returnWindowStartsFrom: true,
              policySource: true, deliveredAt: true, deliveryDate: true, estimatedDeliveryDate: true,
              extractionNotes: true },
  });
  console.log(`\n--- ${label} ---`);
  console.log(`  extractedAt=${d(e?.extractedAt)} emailType=${e?.emailType} retailer=${JSON.stringify(e?.retailer)} orderNumber=${JSON.stringify(e?.orderNumber)}`);
  console.log(`  orderId=${e?.orderId ?? "UNLINKED"} needsReview=${e?.needsReview} confidence=${e?.confidence}`);
  console.log(`  returnWindowDays=${e?.returnWindowDays} startsFrom=${e?.returnWindowStartsFrom} policySource=${e?.policySource}`);
  console.log(`  deliveredAt=${d(e?.deliveredAt)} deliveryDate=${d(e?.deliveryDate)} est=${d(e?.estimatedDeliveryDate)}`);
  console.log(`  NOTES VERBATIM: ${JSON.stringify(e?.extractionNotes)}`);
  return e;
}

async function main() {
  console.log(`EMAIL ${ID}`);
  await snap("BEFORE");
  const t0 = Date.now();
  let thrown: unknown = null;
  try {
    await runExtraction(ID);
  } catch (err) {
    thrown = err;
  }
  const ms = Date.now() - t0;
  console.log(`\n>>> WALL CLOCK: ${(ms / 1000).toFixed(2)}s`);
  if (thrown) console.log(`>>> THREW VERBATIM: ${thrown instanceof Error ? thrown.stack : String(thrown)}`);
  else console.log(`>>> runExtraction returned without throwing`);
  await snap("AFTER");
}
main().finally(() => prisma.$disconnect());

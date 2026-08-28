// Backfill: populate Email.carrier for existing carrier_deferred rows —
// carrier-row-disposition Phase 1 (docs/design/carrier_row_disposition_20260828.md).
//
// Companion to prisma/migrations/20260828215421_add_email_carrier — runs in
// application code, NOT raw SQL, because Email.fromEmail is encrypted at
// rest (AES-256-GCM, per-row random IV). Modeled directly on
// scripts/backfill-carrier-deferred-20260825.ts: same decrypt-in-app-code
// shape, same idempotency approach.
//
// Idempotent: only touches rows where carrier IS NULL AND
// retailerSource = 'carrier_deferred'. Re-running this script (deliberately
// or accidentally) after it's already applied is a no-op.
//
// DB-only, no model calls. Expected billed API count: 0.
//
// Usage:
//   npx tsx scripts/backfill-carrier-name-20260828.ts          # dry run
//   npx tsx scripts/backfill-carrier-name-20260828.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { resolveRetailerFallback } from "../lib/retailerFallback";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.email.findMany({
    where: { carrier: null, retailerSource: "carrier_deferred" },
    select: { id: true, fromEmail: true, fromName: true },
  });

  console.log(`Found ${candidates.length} candidate row(s) (carrier IS NULL, retailerSource = 'carrier_deferred').\n`);

  const toTag: { id: string; fromEmail: string; carrier: string }[] = [];
  for (const e of candidates) {
    const dec = decryptEmailContent(e as any);
    const res = resolveRetailerFallback(dec.fromEmail, dec.fromName);
    if (res.carrier) {
      toTag.push({ id: e.id, fromEmail: dec.fromEmail, carrier: res.carrier });
    }
  }

  console.log(`${toTag.length} row(s) resolve a carrier name:\n`);
  for (const r of toTag) {
    console.log(`  ${r.id}  fromEmail=${r.fromEmail}  carrier=${r.carrier}`);
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. Would tag ${toTag.length} row(s) with a carrier name. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }

  for (const r of toTag) {
    await prisma.email.update({
      where: { id: r.id },
      data: { carrier: r.carrier },
    });
  }

  console.log(`\nDone. Tagged ${toTag.length} row(s) with a carrier name.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

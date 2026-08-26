// Backfill: tag existing carrier-tracking Email rows (FedEx/USPS/etc.) with
// retailerSource = 'carrier_deferred' — the historical half of the Zara
// retailer-fallback build (ZARA_RETAILER_FALLBACK, 2026-08-25).
//
// Companion to prisma/migrations/20260826023215_add_email_retailer_source —
// runs the carrier backfill in application code, NOT raw SQL, because
// Email.fromEmail is encrypted at rest (AES-256-GCM, per-row random IV) and
// there is no plaintext for a migration to pattern-match against. Every
// existing backfill-*.ts touching fromEmail follows the same shape:
// decrypt in app code, write back via Prisma.
//
// Idempotent: only touches rows where retailerSource IS NULL. Re-running
// this script (deliberately or accidentally) after it's already applied is
// a no-op — every previously-tagged row is excluded by that same where
// clause on the second run.
//
// Deliberately does NOT touch rows that would resolve via Step 1/2
// (sender_fallback) — that's the runtime extraction code's job (lib/
// extract.ts, wired in the next commit) going forward on new/re-extracted
// rows. This script's scope is exactly the carrier_deferred set.
//
// Usage:
//   npx tsx scripts/backfill-carrier-deferred-20260825.ts          # dry run
//   npx tsx scripts/backfill-carrier-deferred-20260825.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback } from "../lib/retailerFallback";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  // Decision 2 gate (i)+(ii), plus the idempotency requirement: only rows
  // never touched by this backfill or the runtime fallback before.
  const candidates = await prisma.email.findMany({
    where: {
      retailer: null,
      retailerSource: null,
      extractedAt: { not: null },
      emailType: { in: [...RETAILER_FALLBACK_GATE_EMAIL_TYPES] },
    },
    select: { id: true, emailType: true, fromEmail: true, fromName: true },
  });

  console.log(`Found ${candidates.length} candidate row(s) (retailer IS NULL, retailerSource IS NULL, extractedAt IS NOT NULL, commerce emailType).\n`);

  const toTag: { id: string; fromEmail: string; fromName: string | null }[] = [];
  for (const e of candidates) {
    const dec = decryptEmailContent(e as any);
    const res = resolveRetailerFallback(dec.fromEmail, dec.fromName);
    if (res.retailerSource === "carrier_deferred") {
      toTag.push({ id: e.id, fromEmail: dec.fromEmail, fromName: dec.fromName });
    }
  }

  console.log(`${toTag.length} row(s) match the carrier-domain predicate:\n`);
  for (const r of toTag) {
    console.log(`  ${r.id}  fromEmail=${r.fromEmail}  fromName=${r.fromName ?? "(null)"}`);
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. Would tag ${toTag.length} row(s) with retailerSource = 'carrier_deferred'. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }

  for (const r of toTag) {
    await prisma.email.update({
      where: { id: r.id },
      data: { retailerSource: "carrier_deferred" },
    });
  }

  console.log(`\nDone. Tagged ${toTag.length} row(s) with retailerSource = 'carrier_deferred'.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

// Backfill: apply the sender-derived retailer fallback to existing
// commerce-typed Email rows that were extracted BEFORE lib/runExtraction.ts
// was wired to compute it (ZARA_RETAILER_FALLBACK, 2026-08-25, Step 5).
//
// Necessary because the runtime fallback only fires inside runExtraction()
// — it does not retroactively apply to rows already sitting in the DB, and
// re-running extraction on them would mean a real billed Anthropic call per
// row, which this build is scoped to avoid entirely (0 billed calls). This
// script gets the same real-data outcome at zero cost: decrypt, resolve,
// write, using the exact same lib/retailerFallback.ts logic the live path
// now uses.
//
// Deliberately does NOT call linkEmailToOrder — these rows stay unlinked
// orphans in the needs-review bucket, now correctly labeled instead of
// "Unknown retailer" (Decision 5: this build does not attempt historical
// order linking/creation as a side effect; see
// ZARA_DIAGNOSTIC_FINDINGS_BACKFILL_RADIUS_20260825.md §2c/2d). Only
// targets rows the fallback resolves via Step 1/2 (sender_fallback) —
// carrier rows are already handled by scripts/backfill-carrier-deferred-
// 20260825.ts, and rows where nothing resolves (Step 4) are correctly left
// untouched (retailer stays null, per design).
//
// Idempotent: only touches rows where retailerSource IS NULL. A second run
// after the first is a no-op.
//
// Usage:
//   npx tsx scripts/backfill-sender-fallback-20260825.ts          # dry run
//   npx tsx scripts/backfill-sender-fallback-20260825.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback } from "../lib/retailerFallback";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

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

  const toTag: { id: string; retailer: string; fromEmail: string; fromName: string | null }[] = [];
  for (const e of candidates) {
    const dec = decryptEmailContent(e as any);
    const res = resolveRetailerFallback(dec.fromEmail, dec.fromName);
    if (res.retailerSource === "sender_fallback" && res.retailer) {
      toTag.push({ id: e.id, retailer: res.retailer, fromEmail: dec.fromEmail, fromName: dec.fromName });
    }
  }

  console.log(`${toTag.length} row(s) resolve via sender fallback:\n`);
  for (const r of toTag) {
    console.log(`  ${r.id}  fromEmail=${r.fromEmail}  fromName=${r.fromName ?? "(null)"}  -> retailer="${r.retailer}"`);
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. Would tag ${toTag.length} row(s) with retailer + retailerSource = 'sender_fallback'. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }

  for (const r of toTag) {
    await prisma.email.update({
      where: { id: r.id },
      data: { retailer: r.retailer, retailerSource: "sender_fallback" },
    });
  }

  console.log(`\nDone. Tagged ${toTag.length} row(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

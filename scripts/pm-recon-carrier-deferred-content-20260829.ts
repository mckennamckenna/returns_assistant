// Read-only recon for Phase 6 scoping (carrier-row-disposition, needs-review
// row content quality — TASKS.md 🔴 Now, NEW 2026-08-28). Data gathering
// items (2)-(4): what do the 5 carrier_deferred emails' subject/body/sender
// actually contain, and does any identifying info (which order this belongs
// to) exist in the email at all.
//
// NOT a backfill. Does not write anything. Reuses the exact decrypt pattern
// from scripts/backfill-carrier-deferred-20260825.ts (same lib/emailEncryption
// decryptEmailContent(), same env vars, no new decryption routine, no new
// dependencies).
//
// Scope: only rows where retailerSource === "carrier_deferred" — the DB
// predicate reasonId "carrier_tracking_unlinked" derives from
// (lib/needsReviewRows.ts:94). No other reasonId's rows are read or touched.
//
// Usage:
//   npx tsx scripts/pm-recon-carrier-deferred-content-20260829.ts
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

// Keep the domain (useful for spotting patterns like "@fedex.com" vs a
// forwarding relay), mask everything before the @ so no real address prints.
function maskLocalPart(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return "***";
  return `***@${email.slice(at + 1)}`;
}

async function main() {
  const rows = await prisma.email.findMany({
    where: { retailerSource: "carrier_deferred" },
    select: {
      id: true,
      subject: true,
      textBody: true,
      fromEmail: true,
      fromName: true,
      htmlBody: true,
      receivedAt: true,
      carrier: true,
    },
  });

  console.log(`Found ${rows.length} row(s) with retailerSource = 'carrier_deferred'.\n`);

  for (const row of rows) {
    const dec = decryptEmailContent(row as any);
    const bodyPreview = (dec.textBody ?? "").slice(0, 200);

    console.log("----------------------------------------");
    console.log(`id:        ${row.id}`);
    console.log(`carrier:   ${row.carrier ?? "(null)"}`);
    console.log(`received:  ${row.receivedAt.toISOString()}`);
    console.log(`sender:    ${maskLocalPart(dec.fromEmail)}`);
    console.log(`subject:   ${row.subject ?? "(null)"}`);
    console.log(`body[0:200]: ${bodyPreview || "(empty textBody)"}`);
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

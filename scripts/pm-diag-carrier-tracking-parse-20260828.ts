// Read-only diagnostic: what does parseTracking() return if run against
// the 5 currently-tagged retailerSource='carrier_deferred' rows' real
// bodies? No writes. 0 Anthropic calls (parseTracking is pure regex).
// Scoping input only — not part of any shipped fix.
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { parseTracking } from "../lib/trackingParser";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.email.findMany({
    where: { retailerSource: "carrier_deferred" },
    select: { id: true, fromEmail: true, fromName: true, emailType: true, textBody: true, htmlBody: true, receivedAt: true },
  });

  console.log(`${rows.length} carrier_deferred row(s)\n`);

  for (const r of rows) {
    const dec = decryptEmailContent(r as any);
    const tracking = parseTracking(dec.textBody ?? null, dec.htmlBody ?? null);
    console.log(`id=${r.id} emailType=${r.emailType} fromDomain=${dec.fromEmail.split("@")[1]} receivedAt=${r.receivedAt.toISOString().slice(0, 10)}`);
    console.log(`  parseTracking -> carrier=${tracking.carrier} trackingNumber=${tracking.trackingNumber} trackingUrl=${tracking.trackingUrl ? "(present)" : "null"}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

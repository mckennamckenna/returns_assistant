// READ-ONLY. 0 billed Anthropic calls, 0 writes (findMany only).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: { id: true, retailer: true, extractionNotes: true, emailType: true, returnDeadline: true },
  });
  const tieredRe = /multiple return windows detected/i;
  const tiered = rows.filter(r => r.extractionNotes && tieredRe.test(r.extractionNotes));
  console.log(`tiered-window rows: ${tiered.length}`);

  const byRetailer = new Map<string, number>();
  for (const r of tiered) {
    const key = r.retailer ?? "null";
    byRetailer.set(key, (byRetailer.get(key) ?? 0) + 1);
  }
  console.log("\n--- retailer breakdown of tiered-window rows ---");
  for (const [k, v] of [...byRetailer.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const lookupMarker = /Return policy from web lookup/i;
  const noMarker = tiered.filter(r => !lookupMarker.test(r.extractionNotes!));
  console.log(`\n--- ${noMarker.length} rows with tiered phrase but NO "web lookup" marker (own-email-stated tiering) ---`);
  for (const r of noMarker) {
    console.log(`\nid=${r.id} retailer=${r.retailer ?? "null"} emailType=${r.emailType} returnDeadline=${r.returnDeadline ? r.returnDeadline.toISOString() : "null"}`);
    console.log(r.extractionNotes);
  }
}
main().finally(() => prisma.$disconnect());

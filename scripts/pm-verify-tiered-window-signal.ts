// READ-ONLY. 0 billed Anthropic calls, 0 writes (findMany only).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: { id: true, extractionNotes: true },
  });
  const tieredRe = /multiple return windows detected/i;
  const matches = rows.filter(r => r.extractionNotes && tieredRe.test(r.extractionNotes));
  console.log(`total matches: ${matches.length}`);
  // Check: does the match occur BEFORE "Return policy from web lookup" (i.e. in the primary
  // extraction notes) or AFTER (i.e. only in the appended web-lookup narrative)?
  let beforeLookup = 0, afterLookupOnly = 0, noLookupMarker = 0;
  for (const r of matches) {
    const notes = r.extractionNotes!;
    const lookupIdx = notes.search(/Return policy from web lookup/i);
    const tieredIdx = notes.search(tieredRe);
    if (lookupIdx === -1) { noLookupMarker++; continue; }
    if (tieredIdx < lookupIdx) beforeLookup++; else afterLookupOnly++;
  }
  console.log(`tiered phrase appears BEFORE "web lookup" marker (primary extraction, genuine trigger): ${beforeLookup}`);
  console.log(`tiered phrase appears ONLY AFTER "web lookup" marker (web-lookup artifact, not the email's own trigger): ${afterLookupOnly}`);
  console.log(`no "web lookup" marker present at all in notes: ${noLookupMarker}`);
  console.log("\n--- 3 samples where tiered phrase is AFTER web lookup marker only ---");
  let shown = 0;
  for (const r of matches) {
    const notes = r.extractionNotes!;
    const lookupIdx = notes.search(/Return policy from web lookup/i);
    const tieredIdx = notes.search(tieredRe);
    if (lookupIdx !== -1 && tieredIdx > lookupIdx && shown < 3) {
      console.log(`\nid=${r.id}`);
      console.log(notes);
      shown++;
    }
  }
}
main().finally(() => prisma.$disconnect());

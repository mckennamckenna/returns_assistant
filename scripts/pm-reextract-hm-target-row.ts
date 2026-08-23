// Targeted re-extract of Email.id cmt090ioq0001l404crsih7w9 — H&M
// return_label order-number extraction gap (TASKS.md 🔴 Now), deploy
// step (3). The code fix (lib/emailBodyText.ts, lib/extract.ts) helps
// future inbound only; this specific broken row does NOT self-heal and
// must be re-extracted once to pick up the fix.
//
// BILLED CALLS — estimated up front per the header's cost-disclosure rule:
// baseline read (scripts/pm-check-hm-row-baseline.ts) showed this row's
// prior extraction used policySource: "web_lookup" (H&M's return window
// isn't stated in-body), so re-extraction is expected to trigger THREE
// billed Anthropic calls, not one: (1) primary extraction pass, (2) the
// two-pass retry against htmlBody (this row is exactly the shape that
// triggers it — retailer resolved, orderNumber null), (3) the policy
// web-search lookup (same as before, since the in-body window still
// won't be stated). Writes: 1 Email row update, plus whatever
// linkEmailToOrder does (order link) — real production writes.
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();
const TARGET_ID = "cmt090ioq0001l404crsih7w9";

async function main() {
  console.log("Re-extracting", TARGET_ID, "— up to 3 billed Anthropic calls expected.");
  await runExtraction(TARGET_ID);

  const e = await prisma.email.findUnique({ where: { id: TARGET_ID } });
  console.log({
    id: e?.id,
    orderNumber: e?.orderNumber,
    orderId: e?.orderId,
    needsReview: e?.needsReview,
    retailer: e?.retailer,
    extractedAt: e?.extractedAt,
    notes: e?.extractionNotes,
  });
}

main().finally(() => prisma.$disconnect());

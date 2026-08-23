// Follow-up sweep to the 2026-08-23 H&M return_label extraction fix
// (TASKS.md ✅ Done). Operates ONLY on the specific Email.id values
// confirmed with the owner after the pre-code census + discussion —
// deliberately not a broader query. Owner-approved scope for this run:
// the single genuinely orphaned row surfaced by today's re-run of the
// cousin census (orderNumber AND orderId both null — same shape as
// yesterday's original H&M target row). The other 4 census rows are
// already linked to a parent order via some other signal and are
// handled separately as a no-write pre-check, not swept here.
//
// BILLED CALLS per row — same shape as yesterday's targeted re-extract:
// up to 3 (primary extraction, the two-pass retry if it fires, and a
// policy web-search lookup if the retailer's window isn't stated
// in-body). Real writes: 1 Email row update + whatever linkEmailToOrder
// does.
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmt0uxvz70001ic0468kxgkjp", // Laundry Sauce, shipping_confirmation — orderNumber AND orderId both null
];

async function main() {
  for (const id of TARGET_IDS) {
    const before = await prisma.email.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, orderId: true, needsReview: true },
    });
    if (!before) {
      console.log(id, "— ROW NOT FOUND, skipping");
      continue;
    }

    console.log(`\n=== ${id} — before ===`, before);

    try {
      await runExtraction(id);
    } catch (err) {
      console.log(id, "— ERROR during runExtraction:", err);
      continue;
    }

    const after = await prisma.email.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, orderId: true, needsReview: true },
    });
    console.log(`=== ${id} — after ===`, after);
    console.log(`needsReview cleared: ${before.needsReview === true && after?.needsReview === false}`);
  }
}

main().finally(() => prisma.$disconnect());

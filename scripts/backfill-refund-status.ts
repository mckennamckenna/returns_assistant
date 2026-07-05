// Backfill for Bugs 9+10+11: re-extracts every existing "refund" emailType
// row so it picks up the new refundAmount/refundAmountConfidence fields,
// then re-links/re-derives status through the normal pipeline. At the time
// this was written there were exactly 3 such rows (Lola Blankets, Shopbop,
// H&M) — Lola Blankets was already linked but stuck at displayStatus
// "ordered"; Shopbop and H&M were orphaned (no order number in the email).
//
// Reuses runExtraction() directly for --apply rather than duplicating its
// logic — it already re-extracts AND re-links AND re-derives displayStatus
// in one call, and is safe to re-run (mergeEmailIntoOrder's merge rule is
// additive).
//
// Dry run does NOT call runExtraction (that would write). Instead it calls
// extractEmail() live to preview the new refundAmount/refundAmountConfidence
// without persisting, and previews the linking/status outcome using the
// email's currently-stored retailer/lineItems/orderTotal (matching doesn't
// depend on refundAmount, so re-extraction wouldn't change those in a way
// that affects tier selection). For an orphaned email, shows which
// findRefundFallbackOrder tier would fire (line_item_overlap / total_match /
// recency) or that a new Order would be created — flagged explicitly since
// fuzzy line-item/total matching is a softer inference than the existing
// order-number prefix match, worth eyeballing before applying.
//
// Usage:
//   npx tsx scripts/backfill-refund-status.ts          # dry run
//   npx tsx scripts/backfill-refund-status.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { resolveBodyText } from "@/lib/emailBodyText";
import { extractEmail } from "@/lib/extract";
import { deriveDisplayStatus } from "@/lib/displayStatus";
import { findRefundFallbackOrder } from "@/lib/linkOrder";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

function hasConfirmedAmount(refundAmount: number | null, refundAmountConfidence: string | null): boolean {
  return refundAmount != null && refundAmountConfidence !== "low";
}

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const emails = await prisma.email.findMany({
    where: { emailType: "refund" },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Found ${emails.length} refund email(s).\n`);

  for (const email of emails) {
    console.log(`  emailId: ${email.id}  subject: "${email.subject}"  retailer: ${email.retailer}`);

    if (DRY_RUN) {
      const textBody = email.textBody ? decrypt(email.textBody) : null;
      const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
      const body = resolveBodyText(textBody, htmlBody);
      const preview = body ? await extractEmail(body, email.subject) : null;

      const refundAmount = preview?.refundAmount ?? null;
      const refundAmountConfidence = preview?.refundAmountConfidence ?? null;
      const confirmed = hasConfirmedAmount(refundAmount, refundAmountConfidence);

      console.log(`    NEW refundAmount: ${refundAmount ?? "null"}  refundAmountConfidence: ${refundAmountConfidence ?? "null"}  → confirmed amount: ${confirmed}`);

      if (email.orderId) {
        const order = await prisma.order.findUnique({ where: { id: email.orderId } });
        const target = order ? deriveDisplayStatus(["refund"], order.displayStatus, confirmed) : "(order not found)";
        console.log(`    already linked → order ${email.orderId} (${order?.retailer} #${order?.orderNumber}), current displayStatus: ${order?.displayStatus} → WOULD BECOME: ${target}`);
      } else if (email.retailer) {
        const fallback = await findRefundFallbackOrder(
          email.userId,
          email.retailer,
          Array.isArray(email.lineItems) ? (email.lineItems as unknown[]) : [],
          email.orderTotal,
        );
        if (fallback) {
          console.log(`    ORPHANED → WOULD MATCH via tier "${fallback.tier}" to order ${fallback.order.id} (${fallback.order.retailer} #${fallback.order.orderNumber}, current displayStatus: ${fallback.order.displayStatus})`);
        } else {
          console.log(`    ORPHANED, no candidate order for retailer "${email.retailer}" → WOULD CREATE a new Order from this email alone (sparse: no orderDate, no prior line-item history)`);
        }
      }
    } else {
      await runExtraction(email.id);
      const updated = await prisma.email.findUnique({ where: { id: email.id }, select: { orderId: true, refundAmount: true, refundAmountConfidence: true } });
      const order = updated?.orderId ? await prisma.order.findUnique({ where: { id: updated.orderId } }) : null;
      console.log(`    APPLIED → refundAmount: ${updated?.refundAmount ?? "null"}, orderId: ${updated?.orderId}, order displayStatus: ${order?.displayStatus}, archivedAt: ${order?.archivedAt?.toISOString() ?? "null"}, needsReview: ${order?.needsReview}`);
    }
    console.log();
  }

  console.log(DRY_RUN ? `Dry run complete.` : `Done. Processed ${emails.length} email(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

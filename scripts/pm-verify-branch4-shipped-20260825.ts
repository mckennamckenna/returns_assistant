// Owner-requested verification (2026-08-25, follow-up on Session 2 build):
// does branch 4 (no_extraction_signal) actually ship, or does the
// classifier still fall through to real_purchase_no_record? READ-ONLY —
// 0 writes, 0 Anthropic calls. Imports the ACTUAL shipped functions
// (lib/needsReviewRows.ts, lib/needsReviewReasons.ts) via relative path,
// not a reimplemented copy — unlike the design-session's diagnostic
// script, this one proves what the real code returns, not what a parallel
// copy of the logic would return.
//
// Usage: npx tsx scripts/pm-verify-branch4-shipped-20260825.ts
import { PrismaClient } from "@prisma/client";
import { emailReviewRow } from "../lib/needsReviewRows";
import { NEEDS_REVIEW_REASON_TEXT } from "../lib/needsReviewReasons";

const prisma = new PrismaClient();

async function main() {
  console.log("BRANCH-4 SHIPPED-CODE VERIFICATION — READ ONLY. 0 writes, 0 Anthropic calls.\n");

  const owner = await prisma.user.findUnique({ where: { email: "mckenna.sweazey@gmail.com" }, select: { id: true, email: true } });
  if (!owner) throw new Error("owner not found by email — refusing to guess a userId");

  // Synthetic case from A1's exact spec: emailType=null, no retailer, no
  // orderNumber, no exact match against any candidate order.
  const syntheticEmail = {
    id: "synthetic-a1",
    retailer: null,
    receivedAt: new Date(),
    orderTotal: null,
    orderCurrency: null,
    orderNumber: null,
    emailType: null,
  };
  const syntheticRow = emailReviewRow(syntheticEmail, []);
  console.log("=== A1 synthetic input: emailType=null, no retailer, no orderNumber, no candidate match ===");
  console.log(`  reasonId returned: ${syntheticRow.reasonId}`);
  console.log(`  slot-3 "why" text: ${JSON.stringify(syntheticRow.why)}`);
  console.log(`  matches NEEDS_REVIEW_REASON_TEXT.no_extraction_signal? ${syntheticRow.why === NEEDS_REVIEW_REASON_TEXT.no_extraction_signal}\n`);

  // Live data — same select shape as app/(app)/page.tsx:83-87 and
  // app/(app)/needs-review/page.tsx:33-37 (post-build, emailType included),
  // same ordering as the design-session diagnostic so idx lines up with
  // design doc §3's cited row indices (3, 4, 5, 6, 9, 13-15).
  const [orphanedEmails, linkablePickerOrders] = await Promise.all([
    prisma.email.findMany({
      where: { orderId: null, userId: owner.id, junkedAt: null },
      orderBy: { receivedAt: "desc" },
      select: { id: true, retailer: true, receivedAt: true, orderTotal: true, orderCurrency: true, orderNumber: true, emailType: true },
    }),
    prisma.order.findMany({
      where: { userId: owner.id, archivedAt: null, deletedAt: null },
      select: { id: true, retailer: true, orderNumber: true, orderDate: true },
    }),
  ]);

  console.log(`=== Live orphaned emails: ${orphanedEmails.length} — running the ACTUAL shipped emailReviewRow() on each ===`);
  console.log("idx | retailer | orderNumber | emailType | reasonId | slot-3 why text");
  orphanedEmails.forEach((email, idx) => {
    const row = emailReviewRow(email, linkablePickerOrders);
    console.log(`${idx} | ${email.retailer ?? "null"} | ${email.orderNumber ?? "null"} | ${email.emailType ?? "null"} | ${row.reasonId} | ${JSON.stringify(row.why)}`);
  });

  console.log("\n=== Rows at design doc §3's predicted branch-4 indices (3, 4, 5, 6, 9) ===");
  for (const idx of [3, 4, 5, 6, 9]) {
    const email = orphanedEmails[idx];
    if (!email) {
      console.log(`  idx ${idx}: no row at this index in current live data (population may have shifted since 2026-08-24)`);
      continue;
    }
    const row = emailReviewRow(email, linkablePickerOrders);
    console.log(`  idx ${idx}: reasonId=${row.reasonId}, why=${JSON.stringify(row.why)}`);
  }

  console.log("\nDone. 0 writes, 0 Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

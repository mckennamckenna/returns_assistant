/**
 * scripts/pm-diag-forward-mechanism-and-drift-20260827.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls. 0 DB writes.
 *
 * Part 1: why is forward-header parse success 0/84 for auto-forwards and
 * 11/11 for manual-forwards (DELIVERED_BADGE_DESIGN_20260827.md §3)?
 * Inspect raw bodies to determine structural vs. accidental.
 *
 * Part 2: re-diagnose the Aug 23/24 dashboard-vs-detail drift on order
 * #54421192781, now that the owner has confirmed (Safari + Chrome,
 * cache-refreshed) it is NOT a stale render.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { resolveBodyText } from "../lib/emailBodyText";

const prisma = new PrismaClient();

function preview(text: string | null, chars = 1200): string {
  if (!text) return "(empty)";
  return text.slice(0, chars);
}

async function main() {
  console.log("############################################");
  console.log("PART 1 — mechanism behind the 0%/100% split");
  console.log("############################################\n");

  const deliveryEmails = await prisma.email.findMany({
    where: { emailType: "delivery" },
    select: {
      id: true,
      retailer: true,
      forwardType: true,
      anchorSource: true,
      receivedAt: true,
      textBody: true,
      htmlBody: true,
      fromEmail: true,
      fromName: true,
    },
  });

  const autoSample = deliveryEmails.filter((e) => e.forwardType === "auto").slice(0, 5);
  const manualSample = deliveryEmails
    .filter((e) => e.forwardType === "manual")
    .slice(0, 5);
  // Fallback if forwardType isn't classified on stored rows — pick from anchorSource
  const manualByAnchor = deliveryEmails.filter((e) => e.anchorSource === "quoted_body").slice(0, 5);
  const manualSet = manualSample.length > 0 ? manualSample : manualByAnchor;

  console.log(`--- ${autoSample.length} AUTO-FORWARDED delivery emails (forwardType='auto') ---\n`);
  for (const e of autoSample) {
    const dec = decryptEmailContent(e as any);
    const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
    console.log(`Email ${e.id} | retailer=${e.retailer} | fromEmail=${dec.fromEmail}`);
    const hasForwardBlock = bodyText ? /forwarded message|begin forwarded message|---------- forwarded/i.test(bodyText) : false;
    const dateLineMatch = bodyText ? bodyText.match(/^(?:>\s*)*Date:\s*(.+)$/m) : null;
    console.log(`  has 'forwarded message' block: ${hasForwardBlock}`);
    console.log(`  Date: line found: ${dateLineMatch ? dateLineMatch[0] : "(none)"}`);
    console.log(`  --- body preview (first 1200 chars) ---`);
    console.log(preview(bodyText));
    console.log("  --- end preview ---\n");
  }

  console.log(`\n--- ${manualSet.length} MANUALLY-FORWARDED delivery emails ---\n`);
  for (const e of manualSet) {
    const dec = decryptEmailContent(e as any);
    const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
    console.log(`Email ${e.id} | retailer=${e.retailer} | fromEmail=${dec.fromEmail}`);
    const hasForwardBlock = bodyText ? /forwarded message|begin forwarded message|---------- forwarded/i.test(bodyText) : false;
    const dateLineMatch = bodyText ? bodyText.match(/^(?:>\s*)*Date:\s*(.+)$/m) : null;
    console.log(`  has 'forwarded message' block: ${hasForwardBlock}`);
    console.log(`  Date: line found: ${dateLineMatch ? dateLineMatch[0] : "(none)"}`);
    console.log(`  --- body preview (first 1200 chars) ---`);
    console.log(preview(bodyText));
    console.log("  --- end preview ---\n");
  }

  console.log("\n############################################");
  console.log("PART 2 — surface-drift re-diagnosis, live query");
  console.log("############################################\n");

  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "54421192781" } },
  });
  console.log("=== FULL Order row (all fields) ===");
  console.log(order);

  console.log("\n=== Linked Email rows — every date field ===");
  const emails = await prisma.email.findMany({
    where: { orderId: order?.id },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      emailType: true,
      receivedAt: true,
      extractedAt: true,
      deliveryDate: true,
      anchorDate: true,
      anchorSource: true,
      forwardType: true,
    },
  });
  for (const e of emails) console.log(e);

  console.log("\n=== updatedAt check ===");
  console.log("order.updatedAt:", order?.updatedAt.toISOString());
  console.log("(if this matches last session's 2026-08-26T02:51:27.897Z exactly, nothing has written to this order since — the DB itself has not changed)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

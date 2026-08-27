/**
 * scripts/pm-diag-zara-arrives-stuck-20260826.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls — findMany/findFirst only,
 * no runExtraction/extractEmail/Haiku/Sonnet path touched. 0 DB writes.
 *
 * Purpose: TASKS.md 🔴 Now — "Zara #54421192781 — displayStatus stuck at
 * 'Arrives' past delivery date, delivery email received." Distinguish
 * hypothesis (A) merge/extraction bug (deliveredAt never set) from
 * hypothesis (B) UI bug (badge reads a stale/wrong field) using real data.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Order row ===");
  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "54421192781" } },
    select: {
      id: true,
      userId: true,
      retailer: true,
      orderNumber: true,
      displayStatus: true,
      deliveredAt: true,
      deliveryDate: true,
      estimatedDeliveryDate: true,
      orderDate: true,
      returnDeadline: true,
      updatedAt: true,
    },
  });
  console.log(order);

  if (!order) {
    console.log("No order found with that order number — checking Email rows directly.");
    return;
  }

  console.log("\n=== Linked Email rows ===");
  const emails = await prisma.email.findMany({
    where: { orderId: order.id },
    orderBy: { receivedAt: "asc" },
  });
  for (const e of emails) {
    const dec = decryptEmailContent(e as any);
    console.log({
      id: e.id,
      emailType: e.emailType,
      receivedAt: e.receivedAt,
      extractedAt: e.extractedAt,
      needsReview: e.needsReview,
      deliveryDate: (e as any).deliveryDate,
      fromEmail: dec.fromEmail,
      subject: dec.subject,
    });
  }

  console.log("\n=== Peer query: same-signature Orders ===");
  const peers = await prisma.order.findMany({
    where: { deliveredAt: { not: null }, displayStatus: { not: "returned" } },
    select: { id: true, retailer: true, orderNumber: true, displayStatus: true, deliveredAt: true },
  });
  console.log(`Orders where deliveredAt IS NOT NULL but displayStatus isn't returned: ${peers.length}`);

  const peersB = await prisma.order.findMany({
    where: {
      deliveredAt: null,
      estimatedDeliveryDate: { not: null, lt: new Date() },
    },
    select: { id: true, retailer: true, orderNumber: true, estimatedDeliveryDate: true },
  });
  console.log(
    `Orders with deliveredAt NULL but estimatedDeliveryDate in the past (stuck 'Arrives' signature): ${peersB.length}`
  );
  for (const p of peersB.slice(0, 20)) console.log(" ", p);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

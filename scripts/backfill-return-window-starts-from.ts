// One-time backfill after adding Email/Order.returnWindowStartsFrom
// (Milestone 15). The AI extraction step has always computed this value,
// but it was only ever used in-memory to compute returnDeadline and then
// discarded — never persisted. Every existing email's extractionRaw JSON
// blob already captured it, so this recovers it without re-calling the AI.
//
// Deliberately surgical: only sets returnWindowStartsFrom and recomputes
// returnDeadline from the order's EXISTING orderDate/deliveryDate — it
// does not touch orderDate/deliveryDate themselves. An earlier version of
// this script called rebuildOrderFromRemainingEmails(), which re-derives
// orderDate from scratch and (for orders whose only orderDate came from
// applyFallbackOrderDate's forwarded-header-text parsing) re-ran that
// parsing — new Date() on a string like "Jun 5, 2026 12:04 PM" resolves
// in whatever timezone the *current process* happens to run in, so
// re-running it from a different environment than the original (e.g. a
// local machine instead of the Vercel function that first processed the
// email) silently shifted two real orders' deadlines by exactly the
// local UTC offset. Caught by diffing a before/after snapshot against
// real data, not assumed safe. Recomputing only the deadline, holding
// orderDate/deliveryDate fixed, avoids the whole class of risk.
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/backfill-return-window-starts-from.ts

import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";

const prisma = new PrismaClient();

async function main() {
  const emails = await prisma.email.findMany({ select: { id: true, extractionRaw: true } });
  let updated = 0;

  for (const email of emails) {
    const raw = email.extractionRaw as { returnWindowStartsFrom?: string | null } | null;
    if (!raw || raw.returnWindowStartsFrom === undefined) continue;

    await prisma.email.update({
      where: { id: email.id },
      data: { returnWindowStartsFrom: raw.returnWindowStartsFrom },
    });
    updated++;
  }
  console.log(`Backfilled returnWindowStartsFrom on ${updated} of ${emails.length} emails.`);

  const orders = await prisma.order.findMany({
    include: { emails: { orderBy: { receivedAt: "asc" }, select: { returnWindowStartsFrom: true } } },
  });

  for (const order of orders) {
    // Same precedence as every other merged field: the most recently
    // received email's non-null value wins.
    const winningValue = order.emails.reduce<string | null>((acc, e) => e.returnWindowStartsFrom ?? acc, null);
    if (!winningValue) continue;

    const { returnDeadline, deadlineIsEstimated } = computeDeadline({
      orderDate: order.orderDate ? order.orderDate.toISOString() : null,
      deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
      returnWindowDays: order.returnWindowDays,
      returnWindowStartsFrom: winningValue as "order_date" | "delivery_date",
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        returnWindowStartsFrom: winningValue,
        returnDeadline: returnDeadline ? new Date(returnDeadline) : order.returnDeadline,
        deadlineIsEstimated,
      },
    });
  }
  console.log(`Updated returnWindowStartsFrom + returnDeadline on ${orders.length} orders.`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * scripts/pm-investigate-orderdate-priority-rules-20260827.ts
 *
 * READ-ONLY. 0 billed Anthropic calls. 0 DB writes.
 *
 * Data-driven investigation before deciding the orderDate backfill's
 * priority rule (AI-extracted orderDate vs. forward-resolver anchorDate).
 * Paused mid-session per owner request — this script answers, does not
 * decide.
 */
import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { resolveBodyText } from "../lib/emailBodyText";

const prisma = new PrismaClient();

const ALLOWED_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);

async function main() {
  const allOrders = await prisma.order.findMany({
    select: { id: true, retailer: true, orderNumber: true, orderDate: true, orderDateSource: true },
  });
  console.log(`Total orders: ${allOrders.length}\n`);

  // ---------- PART 1: coverage breakdown ----------
  console.log("############################################");
  console.log("PART 1 — coverage breakdown");
  console.log("############################################\n");

  const candidates = allOrders.filter((o) => o.orderDateSource === "unknown" || o.orderDate === null);
  console.log(`(b) Candidates (orderDateSource='unknown' OR orderDate null): ${candidates.length}`);

  let hasOrderConfirmation = 0;
  let priority1Count = 0; // order_confirmation with non-null AI orderDate
  let priority2Count = 0; // no priority1, but order_confirmation with non-null anchorDate
  let priority2ByAnchorSource = new Map<string, number>();
  let residualCount = 0;
  const priority1Details: any[] = [];
  const priority2Details: any[] = [];
  const residualDetails: any[] = [];

  for (const o of candidates) {
    const emails = await prisma.email.findMany({
      where: { orderId: o.id },
      select: { id: true, emailType: true, orderDate: true, anchorDate: true, anchorSource: true, receivedAt: true },
    });
    const confirmations = emails.filter((e) => e.emailType === "order_confirmation");
    if (confirmations.length > 0) hasOrderConfirmation++;

    const p1 = confirmations.find((e) => e.orderDate != null);
    if (p1) {
      priority1Count++;
      priority1Details.push({ id: o.id, retailer: o.retailer, orderNumber: o.orderNumber, extractedOrderDate: p1.orderDate, anchorDate: p1.anchorDate });
      continue;
    }

    const p2 = confirmations.find((e) => e.anchorDate != null);
    if (p2) {
      priority2Count++;
      const src = p2.anchorSource ?? "null";
      priority2ByAnchorSource.set(src, (priority2ByAnchorSource.get(src) ?? 0) + 1);
      priority2Details.push({ id: o.id, retailer: o.retailer, orderNumber: o.orderNumber, anchorDate: p2.anchorDate, anchorSource: p2.anchorSource });
      continue;
    }

    residualCount++;
    residualDetails.push({
      id: o.id,
      retailer: o.retailer,
      orderNumber: o.orderNumber,
      hasOrderConfirmation: confirmations.length > 0,
      emailTypes: emails.map((e) => e.emailType),
    });
  }

  console.log(`(c) Have an order_confirmation linked at all: ${hasOrderConfirmation}`);
  console.log(`(d) PRIORITY 1 fires (order_confirmation, non-null AI orderDate): ${priority1Count}`);
  console.log(`(e) PRIORITY 2 fires (no P1, order_confirmation has non-null anchorDate): ${priority2Count}`);
  console.log("    by anchorSource:", Object.fromEntries(priority2ByAnchorSource));
  console.log(`(f) RESIDUAL (neither priority fires): ${residualCount}`);

  // ---------- PART 2: broader-gate hypothetical ----------
  console.log("\n############################################");
  console.log("PART 2 — broader-gate hypothetical (shipping/delivery anchorDate for residuals)");
  console.log("############################################\n");

  let broaderGateCount = 0;
  const deltas: number[] = [];
  for (const o of residualDetails) {
    const emails = await prisma.email.findMany({
      where: { orderId: o.id, emailType: { in: ["shipping_confirmation", "delivery"] } },
      select: { anchorDate: true, orderDate: true },
    });
    const withAnchor = emails.find((e) => e.anchorDate != null);
    if (!withAnchor) continue;
    broaderGateCount++;

    // Compare against any OTHER date signal on this order (any email's own extracted orderDate)
    const allEmails = await prisma.email.findMany({ where: { orderId: o.id }, select: { orderDate: true } });
    const otherSignal = allEmails.find((e) => e.orderDate != null);
    if (otherSignal && otherSignal.orderDate) {
      const deltaMs = Math.abs(withAnchor.anchorDate!.getTime() - otherSignal.orderDate.getTime());
      deltas.push(deltaMs / (1000 * 60 * 60 * 24)); // days
    }
  }
  console.log(`Residual orders that WOULD be resolvable via a shipping_confirmation/delivery anchorDate: ${broaderGateCount} / ${residualCount}`);
  console.log(`Of those, orders with ANOTHER date signal to compare against: ${deltas.length}`);
  if (deltas.length > 0) {
    const within1 = deltas.filter((d) => d <= 1).length;
    const within3 = deltas.filter((d) => d <= 3).length;
    const within7 = deltas.filter((d) => d <= 7).length;
    console.log(`  within 1 day: ${within1}, within 3 days: ${within3}, within 7 days: ${within7}, total compared: ${deltas.length}`);
    console.log(`  raw deltas (days):`, deltas.map((d) => d.toFixed(1)));
  } else {
    console.log("  No comparison signal available for any of these residual orders — can't empirically measure shipping-delay noise from this dataset alone.");
  }

  // ---------- PART 3: quality check on priority 1 ----------
  console.log("\n############################################");
  console.log("PART 3 — quality check: does AI-extracted orderDate agree with anchorDate, when both exist?");
  console.log("############################################\n");

  const spotCheckCandidates = priority1Details.filter((d) => d.anchorDate != null).slice(0, 10);
  console.log(`Priority-1 orders where BOTH an extracted orderDate and an anchorDate exist on the same email: ${priority1Details.filter((d) => d.anchorDate != null).length}`);
  for (const c of spotCheckCandidates) {
    const deltaDays = Math.abs(c.extractedOrderDate.getTime() - c.anchorDate.getTime()) / (1000 * 60 * 60 * 24);
    console.log({ retailer: c.retailer, orderNumber: c.orderNumber, extractedOrderDate: c.extractedOrderDate, anchorDate: c.anchorDate, deltaDays: deltaDays.toFixed(2) });
  }
  if (spotCheckCandidates.length === 0) {
    console.log("No priority-1 order has both fields populated on the SAME email to compare directly — this is itself informative: the AI's orderDate extraction and the anchor resolver's anchorDate appear to be mutually exclusive in practice (when the AI finds a stated date, the anchor resolver's regex apparently doesn't also find one on the same email, or vice versa). Widening the check to same-ORDER (not same-email) comparisons instead:");
    let anyCompared = 0;
    for (const d of priority1Details.slice(0, 15)) {
      const emails = await prisma.email.findMany({ where: { orderId: d.id }, select: { anchorDate: true, emailType: true } });
      const anchor = emails.find((e) => e.anchorDate != null);
      if (anchor) {
        anyCompared++;
        const deltaDays = Math.abs(d.extractedOrderDate.getTime() - anchor.anchorDate!.getTime()) / (1000 * 60 * 60 * 24);
        console.log({ retailer: d.retailer, orderNumber: d.orderNumber, extractedOrderDate: d.extractedOrderDate, someOtherEmailAnchorDate: anchor.anchorDate, deltaDays: deltaDays.toFixed(2) });
      }
    }
    console.log(`Compared ${anyCompared} orders' priority-1 extracted value against a DIFFERENT email's anchorDate on the same order.`);
  }

  // ---------- PART 4: the 8 known orders ----------
  console.log("\n############################################");
  console.log("PART 4 — the 2 impossible + 6 flagged orders, predicted outcome");
  console.log("############################################\n");

  const knownOrderNumbers = ["54421192781", "143429832", "F4VLSF", "424051", "444466", "66993117803", "SK213978", "TNK6875105"];
  for (const on of knownOrderNumbers) {
    const order = await prisma.order.findFirst({ where: { orderNumber: on } });
    if (!order) {
      console.log({ orderNumber: on, found: false });
      continue;
    }
    const emails = await prisma.email.findMany({
      where: { orderId: order.id },
      select: { emailType: true, orderDate: true, anchorDate: true, anchorSource: true },
    });
    const confirmations = emails.filter((e) => e.emailType === "order_confirmation");
    const p1 = confirmations.find((e) => e.orderDate != null);
    const p2 = confirmations.find((e) => e.anchorDate != null);
    let predictedRule = "none (residual)";
    let predictedOrderDate: Date | null = null;
    if (p1) {
      predictedRule = "priority 1 (order_confirmation extracted orderDate)";
      predictedOrderDate = p1.orderDate;
    } else if (p2) {
      predictedRule = "priority 2 (order_confirmation anchorDate)";
      predictedOrderDate = p2.anchorDate;
    }
    console.log({
      retailer: order.retailer,
      orderNumber: on,
      currentOrderDate: order.orderDate,
      predictedRule,
      predictedOrderDate,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Targeted data correction for one order: Simply Simpson Boutique #164649
// (order cmu481gzi0003l30448edpnk7), the Act 2 verification gate.
//
// Act 2 (2026-09-21) prevents the wrong-year bug on new mail but does not
// repair stored rows. This order holds deliveryDate/estimatedDeliveryDate
// of 2020-09-28, extracted from a bare "Monday, Sep 28" before the model
// was given an anchor. Expected outcome: 2026-09-28.
//
// SCOPE — deliberately narrow:
//   * ONE order. No other row in the uncertain_details bucket is touched.
//   * extractEmailIdentity ONLY, never finalizeExtraction — no policy
//     lookup. This order has returnWindowDays: null, so finalizeExtraction
//     WOULD fire a billed web-search lookup, on the path the 2026-09-21
//     H&M incident showed producing wrong-and-confident answers.
//   * Writes DATE FIELDS ONLY (deliveryDate, estimatedDeliveryDate,
//     deliveredAt) plus a returnDeadline recomputed from the order's
//     EXISTING returnWindowDays. Never writes retailer, orderNumber,
//     orderTotal, lineItems, confidence or needsReview: those are where
//     run-to-run non-determinism showed up in the 2026-09-21 validation
//     batch, none of them is the bug Act 2 fixed, and rewriting them would
//     churn live data for no stated benefit.
//   * needsReview is deliberately NOT cleared. Correcting the date does not
//     make the order reviewed, and this order still has no returnDeadline
//     at all — see the null-deadline surfacing item in TASKS.md 🔴 Now.
//
// Dry run by default. Pass --apply to write.
//
// Expected billed API calls: 3 primary extractions, plus up to 3 more if
// the alternate-body retry gate trips. ~$0.08.
//
// Usage:
//   npx tsx -r dotenv/config scripts/backfill-simply-simpson-dates-20260921.ts
//   npx tsx -r dotenv/config scripts/backfill-simply-simpson-dates-20260921.ts --apply
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { resolveBodyTextWithAlternate } from "../lib/emailBodyText";
import {
  extractEmailIdentity,
  routeDeliveryDate,
  resolveEstimatedDeliveryDate,
  applyAnchorYearGuard,
  computeDeadline,
} from "../lib/extract";

const prisma = new PrismaClient();
const ORDER_ID = "cmu481gzi0003l30448edpnk7";
const EXPECTED_BEFORE = "2020-09-28";
const EXPECTED_AFTER = "2026-09-28";
const APPLY = process.argv.includes("--apply");

const day = (d: Date | string | null): string =>
  d == null ? "—" : (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: ORDER_ID },
    select: {
      id: true, retailer: true, orderNumber: true, orderDate: true,
      deliveryDate: true, estimatedDeliveryDate: true, deliveredAt: true,
      returnWindowDays: true, returnWindowStartsFrom: true, returnDeadline: true,
      deadlineIsEstimated: true, needsReview: true,
      emails: {
        orderBy: { receivedAt: "asc" },
        select: {
          id: true, subject: true, textBody: true, htmlBody: true, anchorDate: true,
          emailType: true, deliveryDate: true, estimatedDeliveryDate: true,
          deliveredAt: true, orderDate: true, confidence: true, retailer: true,
          orderNumber: true, orderTotal: true,
        },
      },
    },
  });
  if (!order) throw new Error(`Order ${ORDER_ID} not found`);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${order.retailer} #${order.orderNumber}\n`);
  console.log("ORDER BEFORE");
  console.log(`  orderDate       ${day(order.orderDate)}`);
  console.log(`  deliveryDate    ${day(order.deliveryDate)}   estimated: ${day(order.estimatedDeliveryDate)}   deliveredAt: ${day(order.deliveredAt)}`);
  console.log(`  returnDeadline  ${day(order.returnDeadline)}   windowDays: ${order.returnWindowDays ?? "null"}   needsReview: ${order.needsReview}\n`);

  const emailWrites: { id: string; data: Record<string, Date | null> }[] = [];
  let unexpected = false;

  for (const email of order.emails) {
    const textBody = email.textBody ? decrypt(email.textBody) : null;
    const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
    const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);
    if (!primary) {
      console.log(`  ${email.id}: no body text, skipped`);
      continue;
    }

    const parsed = await extractEmailIdentity(primary, email.subject ?? null, email.id, alternate, email.anchorDate);
    const routed = routeDeliveryDate(parsed.emailType, parsed.deliveryDate);
    const estimate = resolveEstimatedDeliveryDate(routed.estimatedDeliveryDate, parsed.shipByDate);
    const guarded = applyAnchorYearGuard(
      { orderDate: parsed.orderDate, estimatedDeliveryDate: estimate, deliveredAt: routed.deliveredAt },
      email.anchorDate,
    );
    const newDeliveryDate =
      parsed.deliveryDate == null ? null : parsed.emailType === "delivery" ? guarded.deliveredAt : guarded.estimatedDeliveryDate;

    console.log(`EMAIL ${email.id}  (${email.emailType} -> ${parsed.emailType})`);
    console.log(`  deliveryDate           ${day(email.deliveryDate)}  ->  ${day(newDeliveryDate)}`);
    console.log(`  estimatedDeliveryDate  ${day(email.estimatedDeliveryDate)}  ->  ${day(guarded.estimatedDeliveryDate)}`);
    console.log(`  deliveredAt            ${day(email.deliveredAt)}  ->  ${day(guarded.deliveredAt)}`);
    console.log(`  [not written] orderDate ${day(email.orderDate)} -> ${day(guarded.orderDate)} | retailer ${email.retailer} -> ${parsed.retailer} | total ${email.orderTotal} -> ${parsed.orderTotal} | confidence ${email.confidence} -> ${parsed.confidence}`);
    if (guarded.note) console.log(`  guard: ${guarded.note}`);

    // Flag anything that is not "wrong year fixed" or "null -> populated".
    const before = email.estimatedDeliveryDate ? day(email.estimatedDeliveryDate) : null;
    const after = guarded.estimatedDeliveryDate ? day(guarded.estimatedDeliveryDate) : null;
    if (before && after && before.slice(5) !== after.slice(5)) {
      console.log(`  *** UNEXPECTED: month/day changed, not just the year (${before} -> ${after}) ***`);
      unexpected = true;
    }
    console.log("");

    emailWrites.push({
      id: email.id,
      data: {
        deliveryDate: newDeliveryDate ? new Date(newDeliveryDate) : null,
        estimatedDeliveryDate: guarded.estimatedDeliveryDate ? new Date(guarded.estimatedDeliveryDate) : null,
        deliveredAt: guarded.deliveredAt ? new Date(guarded.deliveredAt) : null,
      },
    });
  }

  // Order-level fold: merge semantics are "later non-null wins" in
  // receivedAt order (lib/linkOrder.ts's mergeEmailIntoOrder), replayed here
  // over the corrected values. emailWrites is already in receivedAt order.
  const fold = (key: "deliveryDate" | "estimatedDeliveryDate" | "deliveredAt"): Date | null =>
    emailWrites.reduce<Date | null>((acc, w) => w.data[key] ?? acc, null);

  const orderDelivery = fold("deliveryDate");
  const orderEstimate = fold("estimatedDeliveryDate");
  const orderDelivered = fold("deliveredAt");

  // Recomputed from the order's EXISTING returnWindowDays — never a
  // re-looked-up one. Null window in, null deadline out.
  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: order.orderDate ? order.orderDate.toISOString() : null,
    deliveredAt: orderDelivered ? orderDelivered.toISOString() : null,
    estimatedDeliveryDate: orderEstimate ? orderEstimate.toISOString() : null,
    returnWindowDays: order.returnWindowDays,
    returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  console.log("ORDER AFTER (proposed)");
  console.log(`  deliveryDate    ${day(order.deliveryDate)}  ->  ${day(orderDelivery)}`);
  console.log(`  estimated       ${day(order.estimatedDeliveryDate)}  ->  ${day(orderEstimate)}`);
  console.log(`  deliveredAt     ${day(order.deliveredAt)}  ->  ${day(orderDelivered)}`);
  console.log(`  returnDeadline  ${day(order.returnDeadline)}  ->  ${day(returnDeadline)}   (windowDays ${order.returnWindowDays ?? "null"})`);
  console.log(`  needsReview     ${order.needsReview} (unchanged by design)\n`);

  const gateBefore = day(order.estimatedDeliveryDate) === EXPECTED_BEFORE;
  const gatePass = day(orderEstimate) === EXPECTED_AFTER;
  console.log(`ACT 2 GATE: ${EXPECTED_BEFORE} -> ${EXPECTED_AFTER} ? ${gatePass ? "PASS" : "FAIL"} (before matched expected: ${gateBefore})`);
  if (unexpected) console.log("UNEXPECTED CHANGE DETECTED — not writing regardless of flags.");

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write.");
    return;
  }
  if (!gatePass || unexpected) {
    console.log("\nGate did not pass (or unexpected change) — refusing to write.");
    process.exitCode = 1;
    return;
  }

  for (const w of emailWrites) {
    await prisma.email.update({ where: { id: w.id }, data: w.data });
  }
  await prisma.order.update({
    where: { id: ORDER_ID },
    data: {
      deliveryDate: orderDelivery,
      estimatedDeliveryDate: orderEstimate,
      deliveredAt: orderDelivered,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated,
    },
  });
  console.log(`\nWrote ${emailWrites.length} email rows and 1 order row.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

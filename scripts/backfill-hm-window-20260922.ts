// Targeted data correction for one order: H&M #69825036113
// (order cmu6h9dk10003jz040cc2e6jo) — the 2026-09-21 production incident.
//
// The incident: H&M stated a 30-day return window in its own delivery
// email. Two UPS carrier notifications, neither carrying an order number
// or any policy text, each fired a billed web-search lookup returning 3
// and 14 days. When they were manually linked, mergeEmailIntoOrder's
// nullish-coalescing merge let the 3 overwrite the stated 30, moving the
// displayed deadline 27 days early — and, because the merge recomputed
// against a real deliveredAt, presenting it with deadlineIsEstimated
// false. The corrupted deadline (2026-09-21) was found on the day it
// expired.
//
// The 2026-09-22 provenance guard (commit 8599fe1, live in production)
// stops this recurring, but does NOT repair the stored row. This script
// is that repair.
//
// SCOPE — deliberately narrow:
//   * ONE order. No other row is touched, and no Email row is touched at
//     all — the two UPS rows keep their 3 and 14 as history.
//   * NO extraction, NO policy lookup, ZERO billed API calls. The correct
//     value is already stored on this order's own H&M emails
//     (returnWindowDays 30, policySource "email" on both the
//     order_confirmation and a delivery email); it is read, not re-derived.
//   * Writes THREE fields only: returnWindowDays, policySource, and a
//     returnDeadline recomputed by the app's own computeDeadline from the
//     order's existing deliveredAt. Nothing computed by hand.
//   * returnWindowStartsFrom, deliveredAt, deadlineIsEstimated,
//     needsReview, trackingNumber, carrier and every other field are
//     deliberately untouched. deadlineIsEstimated stays false because with
//     a real deliveredAt and a stated window it is now genuinely correct —
//     the flag was not the bug (see the deadlineIsEstimated semantics item
//     in TASKS.md 🟡 Next, which is a separate question).
//
// The apply path also runs recomputeDisplayStatus for this order, since
// the deadline moving from past to future can change derived status.
//
// Dry run by default. Pass --apply to write.
//
// Expected billed API calls: ZERO.
//
// Usage:
//   npx tsx -r dotenv/config scripts/backfill-hm-window-20260922.ts
//   npx tsx -r dotenv/config scripts/backfill-hm-window-20260922.ts --apply
import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";
import { recomputeDisplayStatus } from "../lib/linkOrder";

const prisma = new PrismaClient();

const ORDER_ID = "cmu6h9dk10003jz040cc2e6jo";
const OWNER_USER_ID = "cmqtng57q0000w9y3bzaeax0n";
const APPLY = process.argv.includes("--apply");

// The value the H&M emails themselves state. Asserted against the DB below
// rather than trusted as a constant — if the emails don't actually say 30,
// this script must not write 30.
const EXPECTED_WINDOW = 30;
const EXPECTED_DEADLINE = "2026-10-18T17:42:42.000Z";

async function main() {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (writes nothing) ===\n");

  const order = await prisma.order.findUnique({ where: { id: ORDER_ID } });
  if (!order) throw new Error("order not found");

  // Ownership gate, per CLAUDE.md: confirm before touching a user-scoped row.
  if (order.userId !== OWNER_USER_ID) {
    throw new Error(`ownership mismatch: order.userId=${order.userId} expected=${OWNER_USER_ID}`);
  }
  console.log(`ownership confirmed: order.userId === ${OWNER_USER_ID}\n`);

  // Read the stated window off this order's own emails rather than assuming it.
  const stated = await prisma.email.findMany({
    where: { orderId: ORDER_ID, policySource: "email", returnWindowDays: { not: null } },
    select: { id: true, emailType: true, returnWindowDays: true, returnWindowStartsFrom: true },
  });
  console.log(`stated-window source emails on this order: ${stated.length}`);
  for (const e of stated) {
    console.log(`   ${e.emailType?.padEnd(20)} returnWindowDays=${e.returnWindowDays} startsFrom=${e.returnWindowStartsFrom}`);
  }
  const distinct = [...new Set(stated.map((e) => e.returnWindowDays))];
  if (distinct.length !== 1 || distinct[0] !== EXPECTED_WINDOW) {
    throw new Error(`stated windows are not a unanimous ${EXPECTED_WINDOW}: ${JSON.stringify(distinct)}`);
  }
  console.log(`   -> unanimous stated window: ${distinct[0]} days\n`);

  // Recompute the deadline with the APP'S OWN function, from the order's
  // existing anchor fields and the corrected window. Never computed by hand.
  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: order.orderDate ? order.orderDate.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    estimatedDeliveryDate: order.estimatedDeliveryDate ? order.estimatedDeliveryDate.toISOString() : null,
    returnWindowDays: EXPECTED_WINDOW,
    returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  if (returnDeadline !== EXPECTED_DEADLINE) {
    throw new Error(`computeDeadline returned ${returnDeadline}, expected ${EXPECTED_DEADLINE}`);
  }
  if (deadlineIsEstimated !== false) {
    throw new Error(`computeDeadline returned deadlineIsEstimated=${deadlineIsEstimated}, expected false`);
  }

  const next = {
    returnWindowDays: EXPECTED_WINDOW,
    policySource: "stated_in_email",
    returnDeadline: new Date(returnDeadline),
  };

  console.log("FIELDS THAT WOULD CHANGE:");
  console.log(`   returnWindowDays : ${order.returnWindowDays}  ->  ${next.returnWindowDays}`);
  console.log(`   policySource     : ${order.policySource}  ->  ${next.policySource}`);
  console.log(`   returnDeadline   : ${order.returnDeadline?.toISOString()}  ->  ${next.returnDeadline.toISOString()}`);
  console.log(`   (deadline computed by lib/extract.ts computeDeadline, not by hand)\n`);

  // Prove nothing else moves: diff the full row against itself plus the
  // three intended writes.
  const after = { ...order, ...next };
  const changed: string[] = [];
  for (const key of Object.keys(order) as (keyof typeof order)[]) {
    const a = order[key];
    const b = after[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) changed.push(String(key));
  }
  console.log(`FIELDS CHANGED, computed over ALL ${Object.keys(order).length} Order columns: ${changed.length}`);
  console.log(`   ${changed.join(", ")}`);
  const expectedChanged = ["returnWindowDays", "policySource", "returnDeadline"];
  const unexpected = changed.filter((c) => !expectedChanged.includes(c));
  if (unexpected.length > 0) throw new Error(`unexpected field changes: ${unexpected.join(", ")}`);
  console.log(`   no unexpected changes\n`);

  console.log("EXPLICITLY UNCHANGED (spot-check):");
  for (const k of ["returnWindowStartsFrom", "deliveredAt", "deadlineIsEstimated", "needsReview", "trackingNumber", "carrier", "orderDate", "displayStatus"] as const) {
    const v = order[k as keyof typeof order];
    console.log(`   ${String(k).padEnd(24)} ${v instanceof Date ? v.toISOString() : String(v)}`);
  }

  const emailCount = await prisma.email.count({ where: { orderId: ORDER_ID } });
  console.log(`\nEmail rows on this order: ${emailCount} — NONE are written by this script.`);

  if (!APPLY) {
    console.log("\n=== DRY RUN COMPLETE — nothing written ===");
    return;
  }

  await prisma.order.update({ where: { id: ORDER_ID }, data: next });
  await recomputeDisplayStatus(ORDER_ID);
  console.log("\n=== APPLIED ===");

  const verify = await prisma.order.findUnique({ where: { id: ORDER_ID } });
  console.log("independent read-back:");
  console.log(`   returnWindowDays : ${verify?.returnWindowDays}`);
  console.log(`   policySource     : ${verify?.policySource}`);
  console.log(`   returnDeadline   : ${verify?.returnDeadline?.toISOString()}`);
  console.log(`   deadlineIsEstimated: ${verify?.deadlineIsEstimated}`);
  console.log(`   displayStatus    : ${verify?.displayStatus}`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

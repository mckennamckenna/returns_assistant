/**
 * Backfill for the write-once orderDate fix (TASKS.md 🔴 Now, 2026-08-16).
 *
 * Scope: Suzie Kondi #99500 (id cmrx0ebri0003jr04itjef17j) ONLY. Fitness
 * Superstore #48868 was removed from this backfill's scope — its
 * establishing-email date (2025-07-09) is a year BEFORE its stored date
 * (2026-07-09), the opposite direction from this bug and matching the
 * known wrong-year-extraction shape, not this corruption class. It's
 * deferred to its own read-only look, not touched here.
 *
 * What this does: restores orderDate to the date stated by the earliest
 * establishing email (order_confirmation/shipping_confirmation/delivery)
 * linked to the order, sets orderDateEstimated: false (it's a genuinely
 * stated date, not inferred), and recomputes returnDeadline/
 * deadlineIsEstimated from the restored orderDate via computeDeadline()
 * using the order's ALREADY-STORED returnWindowDays/returnWindowStartsFrom
 * — no new policy lookup.
 *
 * Billed calls: 0. computeDeadline() (lib/extract.ts) is a pure,
 * synchronous function — no web search, no Anthropic call. The only call
 * site that bills anything is lookupReturnPolicy(), which this script never
 * imports or calls; Suzie's row already has a resolved
 * returnWindowDays/returnWindowStartsFrom from its original extraction
 * (21 days, delivery_date — confirmed via the 2026-08-16 provenance dump),
 * so there is nothing to look up.
 *
 * DRY-RUN BY DEFAULT. --apply exists but must be run deliberately and
 * separately — this script does not self-invoke it.
 *
 * Usage:
 *   npx tsx scripts/backfill-writeonce-orderdate-suzie.ts            (dry run)
 *   npx tsx scripts/backfill-writeonce-orderdate-suzie.ts --apply    (writes)
 */
import { PrismaClient } from "@prisma/client";
import { computeDeadline } from "../lib/extract";

const prisma = new PrismaClient();

const TARGET_ORDER_ID = "cmrx0ebri0003jr04itjef17j";
const EXPECTED_RETAILER = "Suzie Kondi";
const EXPECTED_ORDER_NUMBER = "99500";

const ESTABLISHING_EMAIL_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log(`Billed Anthropic calls this run: 0 (computeDeadline is pure; lookupReturnPolicy is never imported)\n`);

  const order = await prisma.order.findUnique({
    where: { id: TARGET_ORDER_ID },
    include: { emails: true },
  });

  if (!order) {
    console.log(`!! Order ${TARGET_ORDER_ID} not found. Aborting.`);
    return;
  }
  if (order.retailer !== EXPECTED_RETAILER || order.orderNumber !== EXPECTED_ORDER_NUMBER) {
    console.log(
      `!! Safety check failed: expected ${EXPECTED_RETAILER} #${EXPECTED_ORDER_NUMBER}, found ${order.retailer} #${order.orderNumber}. Aborting.`,
    );
    return;
  }

  const establishingWithDate = order.emails
    .filter((e) => ESTABLISHING_EMAIL_TYPES.has(e.emailType ?? "") && e.orderDate)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

  if (establishingWithDate.length === 0) {
    console.log("!! No establishing email with a stated orderDate found on this order. Nothing to restore. Aborting.");
    return;
  }

  const restoredOrderDate = establishingWithDate[0].orderDate!;

  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: restoredOrderDate.toISOString(),
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    estimatedDeliveryDate: order.estimatedDeliveryDate ? order.estimatedDeliveryDate.toISOString() : null,
    returnWindowDays: order.returnWindowDays,
    returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

  console.log(`=== ${order.retailer} #${order.orderNumber} (${order.id}) ===\n`);
  console.log("Restore source: earliest establishing email with a stated orderDate —");
  console.log(`  type=${establishingWithDate[0].emailType}, receivedAt=${day(establishingWithDate[0].receivedAt)}, extracted orderDate=${day(establishingWithDate[0].orderDate)}\n`);

  console.log("Field                | Current              | Proposed");
  console.log("----------------------|----------------------|----------------------");
  console.log(`orderDate             | ${day(order.orderDate)}           | ${day(restoredOrderDate)}`);
  console.log(`orderDateEstimated    | ${String(order.orderDateEstimated)}                | false`);
  console.log(`returnDeadline        | ${day(order.returnDeadline)}           | ${day(returnDeadline)}`);
  console.log(`deadlineIsEstimated   | ${String(order.deadlineIsEstimated)}                | ${String(deadlineIsEstimated)}`);
  console.log(`(unchanged) status              : ${order.status}`);
  console.log(`(unchanged) returnWindowDays     : ${order.returnWindowDays}`);
  console.log(`(unchanged) returnWindowStartsFrom: ${order.returnWindowStartsFrom}`);

  if (!APPLY) {
    console.log("\nDRY RUN — no write performed. Re-run with --apply to write.");
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      orderDate: restoredOrderDate,
      orderDateEstimated: false,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated,
    },
  });
  console.log("\nAPPLIED — row updated.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

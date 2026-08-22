/**
 * scripts/pm-diag-caroline-realreal.ts (scratchpad copy, not committed)
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls, 0 DB writes
 * (findMany/findFirst only). Scoped strictly to Caroline Guthrie's account.
 *
 * Purpose: classify a "The RealReal" order-total bug report (amount set via
 * PM_DIAG_ORDER_TOTAL) per the bug-class taxonomy in TASKS.md (Trust-breaking
 * section, 2026-08-08 / 2026-08-14 coverage-check-recurrence entries +
 * 2026-08-16 write-once orderDate entry). Mirrors
 * scripts/pm-diag-orderdate-provenance.ts's ownership-scoping and
 * establishing/non-establishing classification, targeted at one order
 * instead of a population scan.
 *
 * Requires env vars: PM_DIAG_USER_EMAIL, PM_DIAG_ORDER_TOTAL,
 * PM_DIAG_ORDER_ID (the retailer's own order number, e.g. an "R..."
 * RealReal order number).
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

if (!process.env.PM_DIAG_USER_EMAIL) {
  console.error("Set PM_DIAG_USER_EMAIL before running");
  process.exit(1);
}
if (!process.env.PM_DIAG_ORDER_TOTAL) {
  console.error("Set PM_DIAG_ORDER_TOTAL before running");
  process.exit(1);
}
if (!process.env.PM_DIAG_ORDER_ID) {
  console.error("Set PM_DIAG_ORDER_ID before running (the retailer's own order number, e.g. an \"R...\" RealReal order number)");
  process.exit(1);
}
const ORDER_TOTAL = Number(process.env.PM_DIAG_ORDER_TOTAL);
if (Number.isNaN(ORDER_TOTAL)) {
  console.error("PM_DIAG_ORDER_TOTAL must be a number");
  process.exit(1);
}
const USER_EMAIL: string = process.env.PM_DIAG_USER_EMAIL;
const ORDER_NUMBER: string = process.env.PM_DIAG_ORDER_ID;

const ESTABLISHING = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);
const NON_ESTABLISHING = new Set(["refund", "return_label", "other"]);

const OWNER_NAME = "Caroline Guthrie";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const dt = (d: Date | null | undefined) => (d ? d.toISOString() : "—");

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: "Caroline", mode: "insensitive" } },
        { name: { contains: "Guthrie", mode: "insensitive" } },
        { email: { contains: "caroline", mode: "insensitive" } },
        { email: { contains: "guthrie", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });

  console.log(`\n=== User resolution for "${OWNER_NAME}" ===`);
  console.log(users.map((u) => ({ id: u.id, name: u.name, email: u.email })));

  if (users.length !== 1) {
    console.log(`\nSTOP: expected exactly 1 user match, found ${users.length}. Not proceeding via name/email fuzzy match.`);
    console.log(`Falling back: searching for any Order with retailer matching RealReal and orderTotal near $${ORDER_TOTAL.toFixed(2)}, across all users (id/email only, no cross-user content).`);
    const candidateOrders = await prisma.order.findMany({
      where: {
        OR: [
          { retailer: { contains: "RealReal", mode: "insensitive" } },
          { AND: [{ orderTotal: { gte: ORDER_TOTAL - 1 } }, { orderTotal: { lte: ORDER_TOTAL + 1 } }] },
        ],
      },
      select: { id: true, retailer: true, orderNumber: true, orderTotal: true, userId: true, user: { select: { name: true, email: true } } },
    });
    console.log(candidateOrders);
    return;
  }
  const userId = users[0].id;

  const orders = await prisma.order.findMany({
    where: {
      userId,
      OR: [
        { retailer: { contains: "RealReal", mode: "insensitive" } },
        { orderTotal: { gte: ORDER_TOTAL - 1, lte: ORDER_TOTAL + 1 } },
      ],
    },
    include: {
      emails: {
        orderBy: { receivedAt: "asc" },
      },
    },
  });

  console.log(`\n=== Orders matching RealReal / ~$${ORDER_TOTAL.toFixed(2)} for userId ${userId} ===`);
  console.log(`Found ${orders.length} candidate order(s).`);

  for (const o of orders) {
    console.log(`\n--- Order ${o.id} — ${o.retailer} #${o.orderNumber ?? "(none)"} ---`);
    console.log({
      orderDate: dt(o.orderDate),
      orderDateEstimated: o.orderDateEstimated,
      returnDeadline: dt(o.returnDeadline),
      createdAt: dt(o.createdAt),
      updatedAt: dt((o as any).updatedAt),
      status: o.status,
      displayStatus: (o as any).displayStatus,
      keptAt: dt((o as any).keptAt),
      orderTotal: (o as any).orderTotal,
    });

    console.log(`  Linked emails (${o.emails.length}):`);
    let sumAmounts = 0;
    let matchesSingle = false;
    for (const e of o.emails as any[]) {
      const isEstablishing = e.emailType ? ESTABLISHING.has(e.emailType) : false;
      const isNonEstablishing = e.emailType ? NON_ESTABLISHING.has(e.emailType) : false;
      console.log({
        emailId: e.id,
        emailType: e.emailType,
        classification: isEstablishing ? "ESTABLISHING" : isNonEstablishing ? "NON_ESTABLISHING" : "UNKNOWN/NULL",
        receivedAt: dt(e.receivedAt),
        extractedAt: dt(e.extractedAt),
        email_orderDate: dt(e.orderDate),
        orderTotal: e.orderTotal,
        refundAmount: e.refundAmount,
        subject: e.subject ?? "(no subject field captured)",
      });
      if (typeof e.orderTotal === "number") {
        sumAmounts += e.orderTotal;
        if (Math.abs(e.orderTotal - ORDER_TOTAL) < 0.01) matchesSingle = true;
      }
    }
    console.log(`  Sum of linked emails' orderTotal: ${sumAmounts.toFixed(2)}`);
    console.log(`  Single email exact-matches $${ORDER_TOTAL.toFixed(2)}: ${matchesSingle}`);
  }

  // Also check for the exact figure anywhere else on the account (in case
  // it's an aggregate across multiple *separate* Orders, not one Order's
  // linked emails).
  const allOrders = await prisma.order.findMany({
    where: { userId },
    include: { emails: { orderBy: { receivedAt: "asc" } } },
  });
  console.log(`\n=== Full account order count: ${allOrders.length} — scanning for $${ORDER_TOTAL.toFixed(2)} as a cross-order sum ===`);
  let allTotal = 0;
  const realRealLike: any[] = [];
  for (const o of allOrders as any[]) {
    if (o.retailer && /real ?real/i.test(o.retailer)) {
      realRealLike.push({ id: o.id, retailer: o.retailer, orderNumber: o.orderNumber, orderTotal: o.orderTotal, orderDate: day(o.orderDate) });
      if (typeof o.orderTotal === "number") allTotal += o.orderTotal;
    }
  }
  console.log(`RealReal-like orders on account: ${realRealLike.length}`);
  console.log(realRealLike);
  console.log(`Sum of all RealReal-like orders' orderTotal: ${allTotal.toFixed(2)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function checkForOrphanConfirmation() {
  const users = await prisma.user.findMany({ where: { email: USER_EMAIL }, select: { id: true } });
  if (users.length !== 1) return;
  const userId = users[0].id;

  console.log(`\n\n=== Searching ALL of Caroline's emails (linked + unlinked) for order_confirmation near ${ORDER_NUMBER} / RealReal, 2026-07-15 to 2026-08-21 ===`);
  const emails = await prisma.email.findMany({
    where: {
      userId,
      receivedAt: { gte: new Date("2026-07-15T00:00:00Z"), lte: new Date("2026-08-21T23:59:59Z") },
      OR: [
        { orderNumber: ORDER_NUMBER },
        { retailer: { contains: "RealReal", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, emailType: true, orderId: true, orderNumber: true, retailer: true,
      receivedAt: true, extractedAt: true, orderDate: true, orderTotal: true, subject: true,
    },
    orderBy: { receivedAt: "asc" },
  });
  console.table(emails.map(e => ({
    id: e.id, type: e.emailType, orderId: e.orderId ?? "(unlinked)", orderNumber: e.orderNumber,
    receivedAt: e.receivedAt.toISOString(), extracted_orderDate: e.orderDate ? e.orderDate.toISOString().slice(0,10) : "—",
    orderTotal: e.orderTotal, subject: e.subject,
  })));
}

checkForOrphanConfirmation().finally(() => prisma.$disconnect());

// Read-only candidate finder for verifying the widened lookupReturnPolicy
// skip fix (TASKS.md 2026-08-24) live. Looks for an email linking to an
// existing order that already has a resolved returnWindowDays, excluding
// Amazon/food-grocery (never hit the billed branch anyway) and excluding
// H&M/Chan Luu (the 4 deferred cousin rows from the 2026-08-24 sweep are
// explicitly off-limits this session per owner instruction).
// READ-ONLY — no writes, no Anthropic calls.
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "../lib/amazonBundle";
import { isFoodGroceryRetailer } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

async function main() {
  const emails = await prisma.email.findMany({
    where: {
      orderId: { not: null },
      retailer: { notIn: ["H&M", "Chan Luu"], not: null },
    },
    select: {
      id: true,
      retailer: true,
      emailType: true,
      orderNumber: true,
      orderId: true,
      policySource: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "desc" },
  });

  const eligible = emails.filter((e) => e.retailer && !isAmazonOrder(e.retailer) && !isFoodGroceryRetailer(e.retailer));

  const orderIds = [...new Set(eligible.map((e) => e.orderId!))];
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, returnWindowDays: true, retailer: true, orderNumber: true },
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const candidates = eligible
    .filter((e) => {
      const order = orderById.get(e.orderId!);
      return order && order.returnWindowDays != null;
    })
    .slice(0, 5);

  console.log(`Candidates (email linking to an order with resolved returnWindowDays, non-H&M/Chan Luu, non-Amazon/food-grocery):`);
  for (const c of candidates) {
    const order = orderById.get(c.orderId!)!;
    console.log(
      `  emailId=${c.id} retailer=${c.retailer} emailType=${c.emailType} orderNumber=${c.orderNumber} orderId=${c.orderId} orderReturnWindowDays=${order.returnWindowDays} emailPolicySource=${c.policySource ?? "(null)"} receivedAt=${c.receivedAt.toISOString()}`,
    );
  }
  if (candidates.length === 0) console.log("  (none found)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

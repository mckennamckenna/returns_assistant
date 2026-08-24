// Read-only candidate finder for the regression spot-check: an email
// linking to an order whose returnWindowDays is still null (unresolved
// policy) -- re-extracting it should still trigger lookupReturnPolicy
// normally, confirming the skip guard doesn't over-fire.
// READ-ONLY -- no writes, no Anthropic calls.
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "../lib/amazonBundle";
import { isFoodGroceryRetailer } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { returnWindowDays: null, deletedAt: null },
    select: { id: true, retailer: true, orderNumber: true },
  });
  const eligibleOrders = orders.filter((o) => o.retailer && !isAmazonOrder(o.retailer) && !isFoodGroceryRetailer(o.retailer));
  const orderIds = eligibleOrders.map((o) => o.id);

  const emails = await prisma.email.findMany({
    where: { orderId: { in: orderIds }, emailType: { not: "other" } },
    select: { id: true, retailer: true, emailType: true, orderNumber: true, orderId: true, policySource: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
    take: 5,
  });

  console.log("Candidates (email linking to an order with UNRESOLVED returnWindowDays, non-Amazon/food-grocery):");
  for (const e of emails) {
    console.log(
      `  emailId=${e.id} retailer=${e.retailer} emailType=${e.emailType} orderNumber=${e.orderNumber} orderId=${e.orderId} emailPolicySource=${e.policySource ?? "(null)"} receivedAt=${e.receivedAt.toISOString()}`,
    );
  }
  if (emails.length === 0) console.log("  (none found)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

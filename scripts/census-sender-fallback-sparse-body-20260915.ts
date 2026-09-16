// READ-ONLY census. Zero writes, zero billed Anthropic calls — pure DB
// reads and local aggregation. Supports TASKS.md 🔴 Now "Investigation:
// sparse-body extraction on emails with retailerSource='sender_fallback'"
// (2026-09-15), Q3: signature-checked census on Email rows where
// retailerSource='sender_fallback'.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isEmptyLineItems(li: unknown): boolean {
  return li == null || (Array.isArray(li) && li.length === 0);
}

async function main() {
  // (a) Base population.
  const base = await prisma.email.findMany({
    where: { retailerSource: "sender_fallback" },
    select: { id: true, retailer: true, orderId: true },
  });

  console.log(`=== Q3(a) Base population: retailerSource='sender_fallback' ===`);
  console.log(`Total: ${base.length}`);

  const byRetailer = new Map<string, number>();
  for (const e of base) {
    const key = e.retailer ?? "(null)";
    byRetailer.set(key, (byRetailer.get(key) ?? 0) + 1);
  }
  const sortedRetailers = [...byRetailer.entries()].sort((a, b) => b[1] - a[1]);
  for (const [retailer, count] of sortedRetailers) {
    console.log(`  ${retailer}: ${count}`);
  }

  // (b) Of those, linked orders with empty lineItems.
  const linkedOrderIds = [...new Set(base.filter((e) => e.orderId != null).map((e) => e.orderId as string))];
  console.log(`\n=== Q3(b) Linked orders (distinct Order.id via Email.orderId) ===`);
  console.log(`Distinct linked orders: ${linkedOrderIds.length} (of ${base.length} base emails; ${base.length - base.filter((e) => e.orderId != null).length} unlinked)`);

  const orders = await prisma.order.findMany({
    where: { id: { in: linkedOrderIds } },
    select: { id: true, retailer: true, lineItems: true },
  });

  const emptyLineItemOrders = orders.filter((o) => isEmptyLineItems(o.lineItems));
  console.log(`Orders with empty lineItems: ${emptyLineItemOrders.length} / ${orders.length}`);

  const emptyByRetailer = new Map<string, string[]>();
  for (const o of emptyLineItemOrders) {
    const key = o.retailer ?? "(null)";
    if (!emptyByRetailer.has(key)) emptyByRetailer.set(key, []);
    emptyByRetailer.get(key)!.push(o.id);
  }
  const sortedEmpty = [...emptyByRetailer.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`\nRetailer breakdown (empty-lineItems orders):`);
  for (const [retailer, ids] of sortedEmpty) {
    console.log(`  ${retailer}: ${ids.length}`);
  }

  console.log(`\n=== Q3(c) Top retailers — representative order + one order_confirmation email each ===`);
  const top = sortedEmpty.slice(0, 5);
  for (const [retailer, orderIds] of top) {
    const orderId = orderIds[0];
    const repEmail = await prisma.email.findFirst({
      where: { orderId, emailType: "order_confirmation" },
      select: { id: true, orderNumber: true, retailerSource: true },
    });
    console.log(`  ${retailer} (${orderIds.length} orders) — representative order ${orderId}, order_confirmation email: ${repEmail ? repEmail.id : "(none found — may only have non-order_confirmation emails linked)"}`);
  }

  if (sortedEmpty.length > 5) {
    console.log(`\nTail retailers (below top 5, deferred — not characterized this session):`);
    for (const [retailer, ids] of sortedEmpty.slice(5)) {
      console.log(`  ${retailer}: ${ids.length}`);
    }
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

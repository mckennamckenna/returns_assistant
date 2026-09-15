// Step 1 (enumeration only) for the Caroline / Bloomingdale's manual-
// override task, TASKS.md 🔴 Now, 2026-09-14. READ-ONLY — no writes,
// no Anthropic calls. Usage: npx tsx scripts/pm-caroline-bloomingdales-enumerate-20260914.ts
import { PrismaClient } from "@prisma/client";
import { activeOrderFilter } from "../lib/orderFilters";

const prisma = new PrismaClient();

async function main() {
  const byName = await prisma.user.findMany({
    where: { name: { contains: "Caroline", mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = await prisma.user.findMany({
    where: { email: { contains: "caroline", mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  const merged = new Map([...byName, ...byEmail].map((u) => [u.id, u]));
  const candidates = [...merged.values()];

  if (candidates.length !== 1) {
    console.log(`Expected exactly 1 user matching "Caroline" (by name or email), found ${candidates.length}:`);
    candidates.forEach((u) => console.log(`  id=${u.id} name=${u.name ?? "(null)"} emailPrefix=${u.email.slice(0, 3)}***`));
    console.log("STOPPING — owner must disambiguate before enumeration proceeds.");
    return;
  }

  const caroline = candidates[0];
  console.log(`User: id=${caroline.id} name=${caroline.name ?? "(null — matched by email, not name)"} emailPrefix=${caroline.email.slice(0, 3)}***`);
  console.log(`NOTE: matched by email substring only (User.name is null on this account) — owner should confirm this is the intended Caroline before approving any writes.\n`);

  const orders = await prisma.order.findMany({
    where: {
      userId: caroline.id,
      retailer: { equals: "Bloomingdale's", mode: "insensitive" },
      ...activeOrderFilter,
    },
    select: {
      id: true,
      orderNumber: true,
      returnWindowDays: true,
      returnDeadline: true,
      returnWindowStartsFrom: true,
      deadlineIsEstimated: true,
      policySource: true,
      lineItems: true,
      orderDate: true,
      deliveredAt: true,
      estimatedDeliveryDate: true,
    },
  });

  console.log(`Bloomingdale's orders visible on Caroline's dashboard (activeOrderFilter): ${orders.length}\n`);

  for (const o of orders) {
    const emptyLineItems = o.lineItems == null || (Array.isArray(o.lineItems) && o.lineItems.length === 0);
    const linkedEmails = await prisma.email.findMany({
      where: { orderId: o.id },
      select: { policySource: true, extractionNotes: true, emailType: true },
    });
    const notesSource =
      linkedEmails.find((e) => e.policySource === "web_lookup" && e.extractionNotes) ??
      linkedEmails.find((e) => e.extractionNotes);
    console.log(`--- Order ${o.id} (orderNumber=${o.orderNumber ?? "(null)"}) ---`);
    console.log(`  notes (from linked email, emailType=${notesSource?.emailType ?? "n/a"}): "${(notesSource?.extractionNotes ?? "(none)").slice(0, 300)}"`);
    console.log(`  returnWindowDays: ${o.returnWindowDays ?? "(null)"}`);
    console.log(`  returnDeadline: ${o.returnDeadline?.toISOString() ?? "(null)"} (estimated=${o.deadlineIsEstimated})`);
    console.log(`  returnWindowStartsFrom: ${o.returnWindowStartsFrom ?? "(null)"}`);
    console.log(`  policySource: ${o.policySource ?? "(null)"}`);
    console.log(`  lineItems: ${emptyLineItems ? "empty" : "populated"}`);
    console.log(`  orderDate: ${o.orderDate?.toISOString() ?? "(null)"}`);
    console.log(`  deliveredAt: ${o.deliveredAt?.toISOString() ?? "(null)"}`);
    console.log(`  estimatedDeliveryDate: ${o.estimatedDeliveryDate?.toISOString() ?? "(null)"}`);

    const anchor = o.deliveredAt ?? o.estimatedDeliveryDate ?? null;
    if (anchor) {
      const proposed = new Date(anchor);
      proposed.setUTCDate(proposed.getUTCDate() + 30);
      console.log(`  PROPOSED: returnWindowDays=30, returnWindowStartsFrom=delivery_date, returnDeadline=${proposed.toISOString()} (anchor=${o.deliveredAt ? "deliveredAt (confirmed)" : "estimatedDeliveryDate (estimate)"})`);
    } else {
      console.log(`  PROPOSED: returnWindowDays=30, returnWindowStartsFrom=delivery_date, returnDeadline=null (no delivery signal — do not fabricate, do not fall back to orderDate)`);
    }
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

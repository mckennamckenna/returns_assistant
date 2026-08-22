// Per-email redundant lookupReturnPolicy() census — is the ~95% Amazon
// firing rate an Amazon artifact or a systemwide leak?
// READ-ONLY — no writes, no Anthropic calls.
// Usage: npx tsx scripts/census-redundant-policy-lookup.ts
import { PrismaClient } from "@prisma/client";
import { isAmazonOrder } from "../lib/amazonBundle";

const prisma = new PrismaClient();

const EMAIL_TYPES = ["order_confirmation", "shipping_confirmation", "delivery", "return_label", "refund", "other"] as const;

async function main() {
  const allEmails = await prisma.email.findMany({
    select: {
      id: true,
      emailType: true,
      retailer: true,
      policySource: true,
      returnWindowDays: true,
      orderId: true,
      receivedAt: true,
    },
  });

  console.log(`Total Email rows: ${allEmails.length}\n`);

  // === 1. By-type firing table, systemwide ===
  console.log("=== 1 — Firing rate by emailType (systemwide, all retailers) ===");
  console.log("emailType".padEnd(22) + "total".padStart(8) + "web_lookup".padStart(13) + "rate".padStart(9));
  const byType = new Map<string, { total: number; lookedUp: number }>();
  for (const t of [...EMAIL_TYPES, "(null)"]) byType.set(t, { total: 0, lookedUp: 0 });
  for (const e of allEmails) {
    const key = e.emailType ?? "(null)";
    if (!byType.has(key)) byType.set(key, { total: 0, lookedUp: 0 });
    const bucket = byType.get(key)!;
    bucket.total++;
    if (e.policySource === "web_lookup") bucket.lookedUp++;
  }
  let totalAll = 0;
  let lookedUpAll = 0;
  for (const [type, { total, lookedUp }] of byType) {
    if (total === 0) continue;
    totalAll += total;
    lookedUpAll += lookedUp;
    const rate = ((lookedUp / total) * 100).toFixed(1) + "%";
    console.log(type.padEnd(22) + String(total).padStart(8) + String(lookedUp).padStart(13) + rate.padStart(9));
  }
  console.log("TOTAL".padEnd(22) + String(totalAll).padStart(8) + String(lookedUpAll).padStart(13) + (((lookedUpAll / totalAll) * 100).toFixed(1) + "%").padStart(9));

  // === 1b. Same table, Amazon vs non-Amazon ===
  for (const scope of ["amazon", "non-amazon"] as const) {
    console.log(`\n=== 1b — Firing rate by emailType (${scope}) ===`);
    console.log("emailType".padEnd(22) + "total".padStart(8) + "web_lookup".padStart(13) + "rate".padStart(9));
    const scoped = allEmails.filter((e) => (scope === "amazon" ? isAmazonOrder(e.retailer) : !isAmazonOrder(e.retailer)));
    const byTypeScoped = new Map<string, { total: number; lookedUp: number }>();
    for (const e of scoped) {
      const key = e.emailType ?? "(null)";
      if (!byTypeScoped.has(key)) byTypeScoped.set(key, { total: 0, lookedUp: 0 });
      const bucket = byTypeScoped.get(key)!;
      bucket.total++;
      if (e.policySource === "web_lookup") bucket.lookedUp++;
    }
    let sTotal = 0;
    let sLookedUp = 0;
    for (const [type, { total, lookedUp }] of byTypeScoped) {
      sTotal += total;
      sLookedUp += lookedUp;
      const rate = ((lookedUp / total) * 100).toFixed(1) + "%";
      console.log(type.padEnd(22) + String(total).padStart(8) + String(lookedUp).padStart(13) + rate.padStart(9));
    }
    console.log("TOTAL".padEnd(22) + String(sTotal).padStart(8) + String(sLookedUp).padStart(13) + (sTotal ? ((sLookedUp / sTotal) * 100).toFixed(1) + "%" : "n/a").padStart(9));
  }

  // === 2. Redundant lookups on already-windowed orders ===
  // Definition (stated explicitly, since this is a proxy, not an event log):
  // for each Order with a non-null returnWindowDays TODAY, take its linked
  // emails sorted by receivedAt ascending. The first email in that sequence
  // carrying its own non-null returnWindowDays is treated as the email that
  // established the order's window. Any LATER email (by receivedAt) whose
  // policySource is "web_lookup" fired its own paid lookup despite the order
  // already having a resolved window by the time it would have been linked.
  // This assumes emails are extracted/linked in receivedAt order, which
  // matches the pipeline (runExtraction -> linkEmailToOrder, synchronous per
  // inbound webhook call) but is not independently verified by an event log,
  // since none exists. Called out here rather than asserted as fact.
  console.log("\n=== 2 — Redundant web_lookup on orders that already had a window ===");

  const windowedOrders = await prisma.order.findMany({
    where: { returnWindowDays: { not: null } },
    select: { id: true, retailer: true, returnWindowDays: true },
  });

  const emailsByOrder = new Map<string, typeof allEmails>();
  for (const e of allEmails) {
    if (!e.orderId) continue;
    if (!emailsByOrder.has(e.orderId)) emailsByOrder.set(e.orderId, []);
    emailsByOrder.get(e.orderId)!.push(e);
  }

  let redundantTotal = 0;
  let redundantAmazon = 0;
  let redundantNonAmazon = 0;
  const redundantExamples: string[] = [];

  for (const order of windowedOrders) {
    const emails = (emailsByOrder.get(order.id) ?? []).slice().sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    if (emails.length < 2) continue;

    const establishingIdx = emails.findIndex((e) => e.returnWindowDays != null);
    if (establishingIdx === -1) continue; // shouldn't happen given order.returnWindowDays != null, but guard anyway

    for (let i = establishingIdx + 1; i < emails.length; i++) {
      if (emails[i].policySource === "web_lookup") {
        redundantTotal++;
        if (isAmazonOrder(order.retailer)) redundantAmazon++;
        else redundantNonAmazon++;
        if (redundantExamples.length < 8) {
          redundantExamples.push(
            `  order=${order.id} retailer=${order.retailer ?? "(null)"} establishingEmailType=${emails[establishingIdx].emailType} redundantEmailType=${emails[i].emailType} redundantEmailId=${emails[i].id}`,
          );
        }
      }
    }
  }

  console.log(`Orders with a non-null returnWindowDays: ${windowedOrders.length}`);
  console.log(`Total web_lookup emails (all retailers, from table 1): ${lookedUpAll}`);
  console.log(`Redundant web_lookup emails (fired AFTER their order already had a window): ${redundantTotal}`);
  console.log(`  -> as % of all web_lookup emails: ${((redundantTotal / lookedUpAll) * 100).toFixed(1)}%`);
  console.log(`  -> Amazon: ${redundantAmazon}`);
  console.log(`  -> non-Amazon: ${redundantNonAmazon}`);
  if (redundantExamples.length > 0) {
    console.log("Examples (first 8):");
    redundantExamples.forEach((line) => console.log(line));
  }

  // === 3. Amazon vs non-Amazon order counts, for denominator context ===
  const amazonOrders = windowedOrders.filter((o) => isAmazonOrder(o.retailer));
  const nonAmazonOrders = windowedOrders.filter((o) => !isAmazonOrder(o.retailer));
  console.log(`\n=== 3 — Denominator context ===`);
  console.log(`Windowed orders — Amazon: ${amazonOrders.length}, non-Amazon: ${nonAmazonOrders.length}`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

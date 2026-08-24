// Rough sizing for the "Order table has no indexes" follow-up (TASKS.md
// Next, 2026-08-24). Estimates daily volume of emails that trigger at
// least one unindexed Order-table lookup in linkEmailToOrder — i.e. every
// extracted email except food/grocery (short-circuited before any Order
// query) and "other"-typed orphans (never reach the matching branch).
// READ-ONLY — no writes, no Anthropic calls.
// Usage: npx tsx scripts/pm-census-order-query-volume-20260824.ts
import { PrismaClient } from "@prisma/client";
import { isFoodGroceryRetailer } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

async function main() {
  const emails = await prisma.email.findMany({
    where: { extractedAt: { not: null } },
    select: { emailType: true, retailer: true, receivedAt: true },
  });

  const eligible = emails.filter((e) => e.emailType !== "other" && !isFoodGroceryRetailer(e.retailer));

  if (eligible.length === 0) {
    console.log("No eligible extracted emails found.");
    return;
  }

  const byDay = new Map<string, number>();
  for (const e of eligible) {
    const day = e.receivedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const days = [...byDay.keys()].sort();
  const totalDays = days.length;
  const totalEligible = eligible.length;
  const avgPerDay = totalEligible / totalDays;

  const last14 = days.slice(-14);
  const last14Total = last14.reduce((sum, d) => sum + (byDay.get(d) ?? 0), 0);
  const avgPerDayLast14 = last14.length > 0 ? last14Total / last14.length : 0;

  console.log(`Total extracted emails: ${emails.length}`);
  console.log(`Eligible (non-"other", non-food/grocery — reach at least one Order query): ${totalEligible}`);
  console.log(`Span: ${days[0]} to ${days[days.length - 1]} (${totalDays} distinct days)`);
  console.log(`Lifetime average eligible emails/day: ${avgPerDay.toFixed(1)}`);
  console.log(`Last 14 days average eligible emails/day: ${avgPerDayLast14.toFixed(1)}`);
  console.log(`\nNote: each eligible email triggers 1-3 unindexed Order queries today`);
  console.log(`(exact match, then prefix match, then retailer-prefix match, stopping at`);
  console.log(`first hit) via linkEmailToOrder — plus a 2nd exact-match query per email`);
  console.log(`once the parent-order pre-check for the policy-lookup skip ships.`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

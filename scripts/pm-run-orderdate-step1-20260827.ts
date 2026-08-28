import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync("scripts/orderdate-source-backfill-20260827.sql", "utf-8");
  const step1Start = sql.indexOf("-- ── STEP 1: SELECT");
  const step2Start = sql.indexOf("-- ── STEP 2A:");
  const step1Sql = sql.slice(step1Start, step2Start).replace(/^-- .*$/gm, "").trim();

  const rows = await prisma.$queryRawUnsafe<any[]>(step1Sql);
  console.log(`Total rows: ${rows.length}`);

  const byRule = new Map<string, number>();
  for (const r of rows) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
  console.log("By rule:", Object.fromEntries(byRule));

  const realCorrections = rows.filter((r) => r.will_set_order_date_to && r.current_order_date?.getTime() !== new Date(r.will_set_order_date_to).getTime());
  console.log(`\nReal corrections (value actually changes): ${realCorrections.length}`);
  for (const r of realCorrections) {
    console.log({ retailer: r.retailer, orderNumber: r.orderNumber, current: r.current_order_date, will_set_to: r.will_set_order_date_to, rule: r.rule, will_set_return_deadline_to: r.will_set_return_deadline_to });
  }

  const fitnessSuperstore = rows.find((r) => r.orderNumber === "48868");
  console.log("\nFitness Superstore #48868 row (should be 'fallback', excluded):", fitnessSuperstore);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

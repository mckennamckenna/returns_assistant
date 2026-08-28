import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync("scripts/orderdate-source-backfill-20260827.sql", "utf-8");
  // Extract STEP 1's query (between "STEP 1" marker and "STEP 2A" marker)
  const step1Start = sql.indexOf("WITH order_confirmation_candidates AS (\n  SELECT\n    \"orderId\",\n    \"orderDate\" AS extracted_order_date");
  const step2Start = sql.indexOf("-- ── STEP 2A");
  const step1Sql = sql.slice(step1Start, step2Start);

  const rows = await prisma.$queryRawUnsafe<any[]>(step1Sql);
  console.log(`Total rows: ${rows.length}`);

  const byRule = new Map<string, number>();
  for (const r of rows) byRule.set(r.rule, (byRule.get(r.rule) ?? 0) + 1);
  console.log("By rule:", Object.fromEntries(byRule));

  const zara = rows.find((r) => r.orderNumber === "54421192781");
  console.log("\nZara row:", zara);

  const shopbop = rows.find((r) => r.orderNumber === "143429832");
  console.log("\nShopbop row:", shopbop);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

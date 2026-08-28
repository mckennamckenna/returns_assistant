import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
const prisma = new PrismaClient();

function extractSection(sql: string, startMarker: string, endMarker: string | null): string {
  const start = sql.indexOf(startMarker);
  const end = endMarker ? sql.indexOf(endMarker) : sql.length;
  return sql.slice(start, end).replace(/^-- .*$/gm, "").trim();
}

async function main() {
  const sql = fs.readFileSync("scripts/orderdate-source-backfill-20260827.sql", "utf-8");

  const step1Sql = extractSection(sql, "-- ── STEP 1: SELECT", "-- ── STEP 2A:");
  const step2ASql = extractSection(sql, "-- ── STEP 2A:", "-- ── STEP 2B:");
  const step2BSql = extractSection(sql, "-- ── STEP 2B:", "-- Idempotent:");

  const step2AResult = await prisma.$executeRawUnsafe(step2ASql);
  console.log(`STEP 2A executed. Rows affected: ${step2AResult}`);

  const step2BResult = await prisma.$executeRawUnsafe(step2BSql);
  console.log(`STEP 2B executed. Rows affected: ${step2BResult}`);

  console.log("\n--- Re-running STEP 1's SELECT (idempotency check) ---");
  const rows = await prisma.$queryRawUnsafe<any[]>(step1Sql);
  console.log(`Row count now: ${rows.length}`);
  if (rows.length > 0) console.log(rows);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

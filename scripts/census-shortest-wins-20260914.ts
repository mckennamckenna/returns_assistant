// Q2 census for the 2026-09-14 lookupReturnPolicy() shortest-wins
// investigation (TASKS.md). READ-ONLY — no writes, no Anthropic calls.
// Usage: npx tsx scripts/census-shortest-wins-20260914.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NOTES_PATTERNS = [/selected shortest/i, /shortest window/i, /chose shortest/i, /picked shortest/i, /erred toward.*(shortest|safety)|(?:shortest|safety).*erred toward/i];

function notesFlags(notes: string | null): boolean {
  if (!notes) return false;
  return NOTES_PATTERNS.some((re) => re.test(notes));
}

function isEmptyLineItems(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

async function main() {
  const rows = await prisma.email.findMany({
    where: { policySource: "web_lookup" },
    select: {
      id: true,
      retailer: true,
      returnWindowDays: true,
      extractionNotes: true,
      lineItems: true,
    },
  });

  const total = rows.length;
  const shortestWins = rows.filter((r) => notesFlags(r.extractionNotes));
  const emptyLineItems = rows.filter((r) => isEmptyLineItems(r.lineItems));
  const tailShort = rows.filter((r) => r.returnWindowDays != null && r.returnWindowDays <= 7);

  const pct = (n: number) => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);

  console.log(`Total policySource='web_lookup' rows: ${total}\n`);
  console.log(`shortest-wins verbalized in notes: ${shortestWins.length} (${pct(shortestWins.length)})`);
  console.log(`lineItems empty: ${emptyLineItems.length} (${pct(emptyLineItems.length)})`);
  console.log(`returnWindowDays <= 7: ${tailShort.length} (${pct(tailShort.length)})`);

  const shortestSet = new Set(shortestWins.map((r) => r.id));
  const emptySet = new Set(emptyLineItems.map((r) => r.id));
  const tailSet = new Set(tailShort.map((r) => r.id));
  const all3 = rows.filter((r) => shortestSet.has(r.id) && emptySet.has(r.id) && tailSet.has(r.id)).length;
  const shortestOnly = rows.filter((r) => shortestSet.has(r.id) && !emptySet.has(r.id) && !tailSet.has(r.id)).length;
  const emptyOnly = rows.filter((r) => !shortestSet.has(r.id) && emptySet.has(r.id) && !tailSet.has(r.id)).length;
  const tailOnly = rows.filter((r) => !shortestSet.has(r.id) && !emptySet.has(r.id) && tailSet.has(r.id)).length;
  const shortestAndEmpty = rows.filter((r) => shortestSet.has(r.id) && emptySet.has(r.id) && !tailSet.has(r.id)).length;
  const shortestAndTail = rows.filter((r) => shortestSet.has(r.id) && !emptySet.has(r.id) && tailSet.has(r.id)).length;
  const emptyAndTail = rows.filter((r) => !shortestSet.has(r.id) && emptySet.has(r.id) && tailSet.has(r.id)).length;

  console.log(`\nOverlap:`);
  console.log(`  all three: ${all3}`);
  console.log(`  shortest-wins only: ${shortestOnly}`);
  console.log(`  lineItems-empty only: ${emptyOnly}`);
  console.log(`  tail(<=7d) only: ${tailOnly}`);
  console.log(`  shortest+empty (no tail): ${shortestAndEmpty}`);
  console.log(`  shortest+tail (no empty): ${shortestAndTail}`);
  console.log(`  empty+tail (no shortest): ${emptyAndTail}`);

  function byRetailer(set: typeof rows) {
    const m = new Map<string, number>();
    for (const r of set) {
      const key = r.retailer ?? "(null)";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }

  console.log(`\nTop 10 retailers — shortest-wins bucket:`);
  byRetailer(shortestWins).forEach(([r, c]) => console.log(`  ${r}: ${c}`));

  console.log(`\nTop 10 retailers — lineItems-empty bucket:`);
  byRetailer(emptyLineItems).forEach(([r, c]) => console.log(`  ${r}: ${c}`));

  console.log(`\nTop 10 retailers — returnWindowDays<=7 bucket:`);
  byRetailer(tailShort).forEach(([r, c]) => console.log(`  ${r}: ${c}`));

  function sample(set: typeof rows, label: string) {
    console.log(`\nSample (up to 5) — ${label}:`);
    set.slice(0, 5).forEach((r) => {
      console.log(
        `  id=${r.id} retailer=${r.retailer ?? "(null)"} returnWindowDays=${r.returnWindowDays ?? "(null)"} notes="${(r.extractionNotes ?? "").slice(0, 200)}"`,
      );
    });
  }

  sample(shortestWins, "shortest-wins verbalized");
  sample(emptyLineItems, "lineItems empty");
  sample(tailShort, "returnWindowDays<=7");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

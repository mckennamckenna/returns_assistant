// Spot-check: known Gap Inc. orders (Old Navy + additional Gap orders) to
// test whether the 2026-09-06 blast-radius census undercounted the
// affected population. TASKS.md 🔴 Now, 2026-09-06.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Prisma reads + the
// app's own decrypt() helper (textBody, for char count and context only).
//
// Usage: npx tsx scripts/audits/gap-inc-spot-check.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.email.findMany({
    where: {
      retailer: { in: ["Gap", "Old Navy", "Banana Republic", "Athleta"] },
      emailType: "order_confirmation",
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Gap Inc. order_confirmation rows: ${rows.length}\n`);

  for (const r of rows) {
    const text = r.textBody ? decrypt(r.textBody) : "";
    const notes = r.extractionNotes ?? "";
    console.log(`=== ${r.retailer} #${r.orderNumber} (id=${r.id}) ===`);
    console.log("subject:", r.subject);
    console.log("needsReview:", r.needsReview);
    console.log(
      "fields:",
      JSON.stringify({
        orderDate: r.orderDate,
        orderTotal: r.orderTotal,
        returnWindowDays: r.returnWindowDays,
        lineItemsCount: Array.isArray(r.lineItems) ? r.lineItems.length : r.lineItems,
        policySource: r.policySource,
      }),
    );
    console.log("textBody char count:", text.length);
    console.log("textBody first 300 chars:", JSON.stringify(text.slice(0, 300)));
    console.log("extractionNotes:", JSON.stringify(notes));
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

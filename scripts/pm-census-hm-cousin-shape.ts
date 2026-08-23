// READ-ONLY. Zero billed calls. Pure count. TASKS.md 🔴 Now, H&M
// return_label item, deploy step (5) — "cousin census": how many other
// emails across the DB have the same failure shape as the H&M row (retailer
// identified, order number missing, both bodies populated with real
// content, on email types where linking matters). Not a fix — sizes the
// class only. No auto-re-extract; that's a separate owner decision once
// the number is known.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Email"
    WHERE retailer IS NOT NULL
      AND "orderNumber" IS NULL
      AND "emailType" IN ('return_label', 'refund', 'shipping_confirmation')
      AND "textBody" IS NOT NULL
      AND "htmlBody" IS NOT NULL
      AND LENGTH("textBody") > 100
  `;
  console.log("Cousin census count:", rows[0].count.toString());
  console.log("billed Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());

// Backfill: normalize existing Order.returnPortalUrl rows that are missing
// a URL scheme (e.g. "on.com/en-us/faq/returns-and-exchanges" instead of
// "https://on.com/en-us/faq/returns-and-exchanges"). Rendered as-is in an
// <a href>, the browser treats a scheme-less value as a relative path
// against the current origin and 404s. Root cause: the AI (email-body
// extraction and the web-search policy lookup) sometimes returns a bare
// domain/path instead of a fully-qualified URL — fixed at the extraction
// write path in lib/extract.ts; this backfill covers rows written before
// that fix.
//
// Usage:
//   npx tsx scripts/backfill-returnportalurl-scheme.ts          # dry run
//   npx tsx scripts/backfill-returnportalurl-scheme.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { normalizeReturnPortalUrl } from "@/lib/extract";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.order.findMany({
    where: {
      returnPortalUrl: { not: null },
      NOT: { returnPortalUrl: { startsWith: "http" } },
    },
    select: { id: true, retailer: true, orderNumber: true, returnPortalUrl: true },
  });

  console.log(`Found ${candidates.length} order(s) with a scheme-less returnPortalUrl.\n`);

  for (const order of candidates) {
    const fixed = normalizeReturnPortalUrl(order.returnPortalUrl);
    console.log(
      `  ${DRY_RUN ? "WOULD UPDATE" : "UPDATING"} ${order.retailer} #${order.orderNumber} (${order.id})` +
        ` — "${order.returnPortalUrl}" → "${fixed}"`,
    );

    if (!DRY_RUN) {
      await prisma.order.update({
        where: { id: order.id },
        data: { returnPortalUrl: fixed },
      });
    }
  }

  console.log();
  console.log(
    DRY_RUN
      ? `Dry run complete. Would update ${candidates.length} order(s).`
      : `Done. Updated ${candidates.length} order(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

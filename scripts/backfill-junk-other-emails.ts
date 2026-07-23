// One-time backfill for the junk-mechanics change (lib/junk.ts): auto-junk
// only fires going forward, inside linkEmailToOrder's orphan branch — it
// never touches existing rows. The 170 emailType === "other" orphans
// confirmed in production before this change (2026-07-22 diagnostic) would
// otherwise stay un-junked until something re-runs extraction/linking on
// them, which nothing does automatically.
//
// Scoped to exactly shouldAutoJunk's condition, reusing the real function
// so this can't drift from the live auto-junk rule: orderId === null AND
// emailType === "other". Never touches the two populations that must stay
// visible (commerce-typed-but-unlinked; emailType: null failures) — same
// safety boundary as the live path, not a separate/looser one.
//
// WRITTEN BUT NOT RUN, per the task that spawned this file — dry run only
// until explicitly approved.
//
// Usage:
//   npx tsx scripts/backfill-junk-other-emails.ts          # dry run
//   npx tsx scripts/backfill-junk-other-emails.ts --apply  # apply
import { PrismaClient } from "@prisma/client";
import { shouldAutoJunk } from "@/lib/junk";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  console.log(DRY_RUN ? "MODE: DRY RUN — nothing will be changed" : "MODE: APPLYING");
  console.log();

  const candidates = await prisma.email.findMany({
    where: { orderId: null, junkedAt: null },
    select: { id: true, retailer: true, emailType: true, confidence: true, userId: true },
  });

  const eligible = candidates.filter((e) => shouldAutoJunk({ emailType: e.emailType, orderId: null }));

  console.log(`Found ${candidates.length} orphaned, not-yet-junked email(s); ${eligible.length} eligible per shouldAutoJunk.\n`);

  const now = new Date();
  let changed = 0;

  for (const e of eligible) {
    console.log(
      `  ${DRY_RUN ? "WOULD JUNK" : "JUNKING"} ${e.id} — retailer=${e.retailer ?? "(none)"} confidence=${e.confidence ?? "(none)"}`,
    );
    if (!DRY_RUN) {
      await prisma.email.update({ where: { id: e.id }, data: { junkedAt: now } });
    }
    changed++;
  }

  console.log();
  console.log(
    DRY_RUN
      ? `Dry run complete. Would junk ${changed} email(s).`
      : `Done. Junked ${changed} email(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// READ-ONLY. Checks whether any emailType:null, unlinked (orderId: null)
// email exists in the current coverage-check window, across all users —
// to confirm with a real example (or honestly report there isn't one right
// now) that the extraction-failure visibility path is unaffected by the
// establishing-email gate shipped in app/api/cron/weekly-coverage/route.ts.
// No sendEmail, no Reminder writes, no other user's content printed beyond
// retailer/subject (same fields the real digest itself would render).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 7;

async function main() {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.email.findMany({
    where: { receivedAt: { gte: lookbackStart }, junkedAt: null, orderId: null, emailType: null },
    select: { id: true, userId: true, retailer: true, subject: true, receivedAt: true },
  });

  console.log(`emailType:null, unlinked, not-junked rows in the current window (${lookbackStart.toISOString()} -> ${now.toISOString()}): ${rows.length}\n`);
  for (const r of rows) {
    console.log(`  userId=${r.userId} retailer=${r.retailer ?? "null"} receivedAt=${r.receivedAt.toISOString()} subject="${r.subject ?? ""}"`);
  }
  console.log(`\nbilled Anthropic calls this run: 0 · DB writes: 0`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

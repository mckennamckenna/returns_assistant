// READ-ONLY follow-up repro. Finds the actual weekly_coverage_check
// Reminder.sentAt for the account set via PM_DIAG_USER_EMAIL, rebuilds the digest against
// the REAL window used at that exact send time, and reports both the
// junked and unjunked state of every candidate row (to catch rows that were
// unjunked at send time but got junked afterward). No writes, no Anthropic
// calls.
//
// Usage: npx tsx scripts/pm-repro-coverage-digest-mckenna-v2.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 7;

async function main() {
  if (!process.env.PM_DIAG_USER_EMAIL) {
    console.error("Set PM_DIAG_USER_EMAIL before running");
    process.exit(1);
  }
  const user = await prisma.user.findFirst({ where: { email: process.env.PM_DIAG_USER_EMAIL } });
  if (!user) return console.log("User not found.");

  const reminders = await prisma.reminder.findMany({
    where: { userId: user.id, reminderType: "weekly_coverage_check" },
    orderBy: { sentAt: "desc" },
    take: 5,
  });
  console.log("Recent weekly_coverage_check Reminder rows (most recent first):");
  for (const r of reminders) console.log(`  sentAt=${r.sentAt.toISOString()}`);

  const sendTime = reminders[0]?.sentAt;
  if (!sendTime) return console.log("\nNo Reminder row found — can't pin exact send time.");

  const lookbackStart = new Date(sendTime.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`\nReal send window: ${lookbackStart.toISOString()} -> ${sendTime.toISOString()}\n`);

  // Deliberately NOT filtering junkedAt here -- we want to see everything
  // that was ever a candidate, plus when (if ever) it got junked, to tell
  // "visible at send time, junked later" apart from "never a candidate."
  const candidates = await prisma.email.findMany({
    where: { userId: user.id, receivedAt: { gte: lookbackStart, lte: sendTime } },
    include: { order: { select: { retailer: true, orderTotal: true, orderCurrency: true, orderDate: true } } },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`All candidate emails in the real send window (junked or not): ${candidates.length}\n`);
  for (const e of candidates) {
    const junkNote = e.junkedAt ? `JUNKED at ${e.junkedAt.toISOString()}` : "not junked";
    console.log(
      `${e.id} | received=${e.receivedAt.toISOString()} | type=${e.emailType ?? "null"} | orderId=${e.orderId ?? "null"} | retailer=${e.retailer ?? "null"} | subject="${e.subject ?? ""}" | ${junkNote}`,
    );
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

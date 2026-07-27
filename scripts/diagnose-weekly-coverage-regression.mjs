// Read-only diagnostic for the "Friday weekly coverage-check digest badly
// broken" regression (TASKS.md Bugs -> Trust-breaking). No writes. Replicates
// app/api/cron/weekly-coverage/route.ts's exact query logic against real data
// so we can see what the digest would surface right now, plus pulls the real
// send history to pin down which Friday runs actually happened.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const LOOKBACK_DAYS = 7;
const JUNK_FILTER = { junkedAt: null };

async function main() {
  console.log("=== 1. Real send history: weekly_coverage_check Reminder rows, all time ===");
  const reminders = await prisma.reminder.findMany({
    where: { reminderType: "weekly_coverage_check" },
    orderBy: { sentAt: "desc" },
    select: { id: true, userId: true, sentAt: true },
  });
  for (const r of reminders) {
    console.log(`  ${r.sentAt.toISOString()}  (${r.sentAt.toLocaleDateString("en-US", { weekday: "long" })})  user=${r.userId}`);
  }
  if (reminders.length === 0) console.log("  (none ever written)");

  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true } });
  console.log(`\n=== ${users.length} user(s) total ===`);

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`\nContent-window lookbackStart (rolling 7d from NOW, matches route.ts exactly): ${lookbackStart.toISOString()}`);

  for (const user of users) {
    const recentEmails = await prisma.email.findMany({
      where: { userId: user.id, receivedAt: { gte: lookbackStart }, ...JUNK_FILTER },
      include: { order: { select: { retailer: true, orderTotal: true, orderCurrency: true } } },
      orderBy: { receivedAt: "asc" },
    });

    if (recentEmails.length === 0) continue;

    console.log(`\n--- User ${user.id} (${user.email}) — ${recentEmails.length} email(s) pass JUNK_FILTER + lookback ---`);

    const seenOrderIds = new Set();
    const messageIdCounts = new Map();
    let lineNum = 0;
    for (const email of recentEmails) {
      const mid = email.messageId ?? "(null — pre-dedup-guard row)";
      messageIdCounts.set(mid, (messageIdCounts.get(mid) ?? 0) + 1);

      let wouldSkip = false;
      let retailerShown;
      if (email.orderId) {
        if (seenOrderIds.has(email.orderId)) {
          wouldSkip = true;
        } else {
          seenOrderIds.add(email.orderId);
          retailerShown = email.order?.retailer ?? null;
        }
      } else {
        retailerShown = email.retailer;
      }

      if (!wouldSkip) lineNum++;
      const flag = !wouldSkip && retailerShown == null ? "  <-- UNKNOWN RETAILER (REAL DIGEST LINE)" : "";
      console.log(
        `  [${wouldSkip ? "skip(dup order)" : `line ${lineNum}`}] emailId=${email.id} emailType=${email.emailType ?? "null"} ` +
        `orderId=${email.orderId ?? "null"} retailer=${retailerShown === undefined ? "(n/a)" : retailerShown ?? "null"} ` +
        `receivedAt=${email.receivedAt.toISOString()} messageId=${mid}${flag}`
      );
    }

    console.log(`  -- messageId repeats in this user's window (would produce duplicate-looking lines if orderId is null on all copies) --`);
    for (const [mid, count] of messageIdCounts) {
      if (count > 1) console.log(`     messageId=${mid} appears ${count}x`);
    }
  }

  console.log("\n\n=== SUMMARY: real digest lines only (skip-dup-order excluded) across all users, this run ===");
  let totalRealLines = 0;
  let totalUnknownLines = 0;
  const unknownByEmailType = new Map();
  const unknownByRetailerText = new Map();
  for (const user of users) {
    const recentEmails = await prisma.email.findMany({
      where: { userId: user.id, receivedAt: { gte: lookbackStart }, ...JUNK_FILTER },
      include: { order: { select: { retailer: true, orderTotal: true, orderCurrency: true } } },
      orderBy: { receivedAt: "asc" },
    });
    const seenOrderIds = new Set();
    for (const email of recentEmails) {
      let retailerShown;
      if (email.orderId) {
        if (seenOrderIds.has(email.orderId)) continue;
        seenOrderIds.add(email.orderId);
        retailerShown = email.order?.retailer ?? null;
      } else {
        retailerShown = email.retailer;
      }
      totalRealLines++;
      if (retailerShown == null) {
        totalUnknownLines++;
        const key = email.emailType ?? "null";
        unknownByEmailType.set(key, (unknownByEmailType.get(key) ?? 0) + 1);
      }
    }
  }
  console.log(`Total real digest lines (right now, across all ${users.length} users): ${totalRealLines}`);
  console.log(`Of those, "unknown retailer" lines: ${totalUnknownLines} (${((totalUnknownLines / totalRealLines) * 100).toFixed(1)}%)`);
  console.log(`Breakdown of unknown-retailer lines by emailType:`);
  for (const [type, count] of unknownByEmailType) console.log(`  emailType=${type}: ${count}`);

  console.log("\n=== AquaTru check: any order/email matching 'AquaTru' currently in or near the digest window? ===");
  const aquaOrders = await prisma.order.findMany({ where: { retailer: { contains: "AquaTru", mode: "insensitive" } } });
  for (const o of aquaOrders) {
    console.log(`  Order ${o.id} retailer=${o.retailer} displayStatus=${o.displayStatus} orderDate=${o.orderDate?.toISOString()} returnDeadline=${o.returnDeadline?.toISOString()}`);
    const emails = await prisma.email.findMany({ where: { orderId: o.id }, select: { id: true, receivedAt: true, emailType: true, junkedAt: true } });
    for (const e of emails) console.log(`    email ${e.id} receivedAt=${e.receivedAt.toISOString()} emailType=${e.emailType} junkedAt=${e.junkedAt?.toISOString() ?? "null"} inLookbackWindow=${e.receivedAt >= lookbackStart}`);
  }
  if (aquaOrders.length === 0) console.log("  (no AquaTru order found)");

  console.log("\n=== Daily count of emailType===null orphans (extraction-failure fingerprint), last 21 days, ALL users ===");
  const since21 = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  const nullTypeOrphans = await prisma.email.findMany({
    where: { emailType: null, orderId: null, receivedAt: { gte: since21 } },
    select: { receivedAt: true },
    orderBy: { receivedAt: "asc" },
  });
  const byDay = new Map();
  for (const e of nullTypeOrphans) {
    const day = e.receivedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  for (const [day, count] of byDay) console.log(`  ${day}: ${count}`);
  console.log(`  TOTAL last 21 days: ${nullTypeOrphans.length}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

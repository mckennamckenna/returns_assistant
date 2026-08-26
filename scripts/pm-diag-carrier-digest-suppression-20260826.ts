// READ-ONLY diagnostic. Step 1 of the carrier-row digest-suppression crawl
// step (TASKS.md 🟡 Next "Carrier-row disposition", option (d)).
//
// Rebuilds the weekly-coverage digest's item set exactly as
// app/api/cron/weekly-coverage/route.ts does today (same LOOKBACK_DAYS,
// same JUNK_FILTER, same purchase-signal gate, same staleness check) for
// EVERY user, using "now" as the window end — the closest read-only proxy
// for "what would next Friday's digest show if it ran right now." Then
// classifies every item that would render with retailer === null (the
// "Unknown retailer" line) by the triggering email's retailerSource, so we
// can see whether carrier-deferred suppression alone gets to zero.
//
// Zero writes. Zero Anthropic API calls (no extraction, no model calls —
// pure DB read + the same in-memory logic already in route.ts).
//
// Usage: npx tsx scripts/pm-diag-carrier-digest-suppression-20260826.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 7;
const ESTABLISHING_EMAIL_TYPES = ["order_confirmation", "shipping_confirmation", "delivery"];

async function main() {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`Simulated window: ${lookbackStart.toISOString()} -> ${now.toISOString()}\n`);

  const users = await prisma.user.findMany();

  type UnknownRow = {
    userEmail: string;
    emailId: string;
    linked: boolean;
    retailerSource: string | null;
    receivedAt: string;
    subject: string | null;
  };
  const unknownRows: UnknownRow[] = [];
  let totalCandidateEmails = 0;
  let totalItemsAcrossUsers = 0;

  for (const user of users) {
    const recentEmails = await prisma.email.findMany({
      where: { userId: user.id, receivedAt: { gte: lookbackStart }, junkedAt: null },
      include: {
        order: {
          select: {
            retailer: true,
            orderTotal: true,
            orderCurrency: true,
            orderDate: true,
            emails: { where: { emailType: { in: ESTABLISHING_EMAIL_TYPES } }, select: { id: true }, take: 1 },
          },
        },
      },
    });
    totalCandidateEmails += recentEmails.length;

    const seenOrderIds = new Set<string>();
    for (const email of recentEmails) {
      if (email.orderId) {
        if (seenOrderIds.has(email.orderId)) continue;
        seenOrderIds.add(email.orderId);
        const hasEstablishingEmail = (email.order?.emails?.length ?? 0) > 0;
        if (!hasEstablishingEmail) continue;
        const placedDate = email.order?.orderDate ?? null;
        if (placedDate !== null && placedDate < lookbackStart) continue;
        totalItemsAcrossUsers++;
        const retailer = email.order?.retailer ?? null;
        if (retailer === null) {
          unknownRows.push({
            userEmail: user.email,
            emailId: email.id,
            linked: true,
            retailerSource: email.retailerSource,
            receivedAt: email.receivedAt.toISOString(),
            subject: email.subject,
          });
        }
      } else {
        totalItemsAcrossUsers++;
        if (email.retailer === null) {
          unknownRows.push({
            userEmail: user.email,
            emailId: email.id,
            linked: false,
            retailerSource: email.retailerSource,
            receivedAt: email.receivedAt.toISOString(),
            subject: email.subject,
          });
        }
      }
    }
  }

  console.log(`Users checked: ${users.length}`);
  console.log(`Total candidate emails (post-JUNK_FILTER, in window): ${totalCandidateEmails}`);
  console.log(`Total digest line items across all users (pre-suppression): ${totalItemsAcrossUsers}`);
  console.log(`Of those, "Unknown retailer" items: ${unknownRows.length}\n`);

  const bySource = new Map<string, number>();
  for (const row of unknownRows) {
    const key = row.retailerSource ?? "null";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  console.log("Breakdown of Unknown-retailer items by retailerSource:");
  for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  console.log("\nDetail:");
  for (const row of unknownRows) {
    console.log(
      `  ${row.linked ? "linked  " : "unlinked"} | source=${row.retailerSource ?? "null"} | received=${row.receivedAt} | user=${row.userEmail} | emailId=${row.emailId} | subject="${row.subject ?? ""}"`,
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

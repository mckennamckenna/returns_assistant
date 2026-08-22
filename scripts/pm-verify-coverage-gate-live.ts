// READ-ONLY verification of the establishing-email gate shipped in
// app/api/cron/weekly-coverage/route.ts (commit 2da71e4). Replicates that
// route's exact query + filtering logic against real current data — same
// JUNK_FILTER, same lookbackStart window, same ESTABLISHING_EMAIL_TYPES
// gate, same placedDate staleness check — WITHOUT calling sendEmail or
// writing a Reminder row. Never imports @/lib/postmark or touches
// prisma.reminder at all, by construction, so there's no path to a real
// send or a dedup-affecting write. 0 billed Anthropic calls (no extraction
// path touched), 0 DB writes (findMany/findUnique only).
//
// Scoped to mckenna.sweazey@gmail.com — the account the shipped bug (the
// J.Crew #2523415500 orphan) was diagnosed and fixed against — plus a
// count-only cross-user aggregate (no other user's order details printed).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 7;
const ESTABLISHING_EMAIL_TYPES = ["order_confirmation", "shipping_confirmation", "delivery"];
const OWNER_EMAIL = "mckenna.sweazey@gmail.com";

interface Row {
  orderId: string | null;
  retailer: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
  orderDate: Date | null;
  hasEstablishingEmail: boolean;
  emailType: string | null; // the triggering email's own type, for the unlinked/extraction-failure case
}

async function buildForUser(userId: string, lookbackStart: Date) {
  const recentEmails = await prisma.email.findMany({
    where: { userId, receivedAt: { gte: lookbackStart }, junkedAt: null },
    include: {
      order: {
        select: {
          id: true,
          retailer: true,
          orderTotal: true,
          orderCurrency: true,
          orderDate: true,
          emails: { where: { emailType: { in: ESTABLISHING_EMAIL_TYPES } }, select: { id: true }, take: 1 },
        },
      },
    },
  });

  const included: Row[] = [];
  const excludedOrphan: Row[] = []; // dropped by the NEW establishing-email gate
  const excludedStale: Row[] = []; // dropped by the pre-existing placedDate staleness check
  const seenOrderIds = new Set<string>();

  for (const email of recentEmails) {
    if (email.orderId) {
      if (seenOrderIds.has(email.orderId)) continue;
      seenOrderIds.add(email.orderId);
      const hasEstablishingEmail = (email.order?.emails?.length ?? 0) > 0;
      const row: Row = {
        orderId: email.orderId,
        retailer: email.order?.retailer ?? null,
        orderTotal: email.order?.orderTotal ?? null,
        orderCurrency: email.order?.orderCurrency ?? null,
        orderDate: email.order?.orderDate ?? null,
        hasEstablishingEmail,
        emailType: email.emailType,
      };
      if (!hasEstablishingEmail) {
        excludedOrphan.push(row);
        continue;
      }
      const placedDate = email.order?.orderDate ?? null;
      if (placedDate !== null && placedDate < lookbackStart) {
        excludedStale.push(row);
        continue;
      }
      included.push(row);
    } else {
      included.push({
        orderId: null,
        retailer: email.retailer,
        orderTotal: null,
        orderCurrency: null,
        orderDate: null,
        hasEstablishingEmail: false,
        emailType: email.emailType,
      });
    }
  }

  return { included, excludedOrphan, excludedStale };
}

function fmt(r: Row): string {
  const total = r.orderTotal != null ? ` — ${r.orderCurrency ?? "$"}${r.orderTotal}` : "";
  const id = r.orderId ? ` (order ${r.orderId})` : " (unlinked)";
  const type = r.emailType ? ` [triggering email: ${r.emailType}]` : "";
  return `${r.retailer ?? "an unknown retailer"}${total}${id}${type}`;
}

async function main() {
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  console.log(`READ-ONLY coverage-gate verification. now=${now.toISOString()} lookbackStart=${lookbackStart.toISOString()}`);
  console.log("No sendEmail call, no Reminder write — this script never imports either.\n");

  const owner = await prisma.user.findFirst({ where: { email: OWNER_EMAIL } });
  if (!owner) return console.log("Owner not found.");

  const { included, excludedOrphan, excludedStale } = await buildForUser(owner.id, lookbackStart);

  console.log(`=== ${OWNER_EMAIL} — WOULD-INCLUDE (purchase list, ${included.length} line(s)) ===`);
  included.forEach((r) => console.log(`  + ${fmt(r)}`));
  if (included.length === 0) console.log("  (none)");

  console.log(`\n=== ${OWNER_EMAIL} — WOULD-EXCLUDE: dropped by the NEW establishing-email gate (${excludedOrphan.length}) ===`);
  excludedOrphan.forEach((r) => console.log(`  - ${fmt(r)}`));
  if (excludedOrphan.length === 0) console.log("  (none)");

  console.log(`\n=== ${OWNER_EMAIL} — WOULD-EXCLUDE: dropped by the pre-existing placedDate staleness check (${excludedStale.length}) ===`);
  excludedStale.forEach((r) => console.log(`  - ${fmt(r)}`));
  if (excludedStale.length === 0) console.log("  (none)");

  // Specific check requested: is the J.Crew orphan #2523415500 present anywhere, and if so, where?
  const jcrewOrphanId = "cmsr633e00003l1049lnzyre9";
  const inIncluded = included.some((r) => r.orderId === jcrewOrphanId);
  const inExcludedOrphan = excludedOrphan.some((r) => r.orderId === jcrewOrphanId);
  console.log(`\n=== Specific check: J.Crew orphan #2523415500 (${jcrewOrphanId}) ===`);
  if (inIncluded) console.log("  !! STILL IN the purchase list — gate did not catch it.");
  else if (inExcludedOrphan) console.log("  Correctly excluded by the establishing-email gate.");
  else console.log("  Not present in this week's candidate emails at all (outside the current 7-day window) — gate untested by this run for this specific row; see note below.");

  // Cross-user aggregate — counts only, no other user's order/email details.
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  let totalIncluded = 0;
  let totalExcludedOrphan = 0;
  let totalExcludedStale = 0;
  for (const u of allUsers) {
    const r = await buildForUser(u.id, lookbackStart);
    totalIncluded += r.included.length;
    totalExcludedOrphan += r.excludedOrphan.length;
    totalExcludedStale += r.excludedStale.length;
  }
  console.log(`\n=== Cross-user aggregate (${allUsers.length} users, counts only) ===`);
  console.log(`  would-include total: ${totalIncluded}`);
  console.log(`  excluded by establishing-gate total: ${totalExcludedOrphan}`);
  console.log(`  excluded by staleness check total: ${totalExcludedStale}`);

  console.log(`\nbilled Anthropic calls this run: 0 · DB writes: 0 · sendEmail calls: 0 · Reminder rows written: 0`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

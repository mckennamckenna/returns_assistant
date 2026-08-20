// Food + grocery delivery exclusion — Step 2 historical sweep, APPLY.
// TASKS.md 🔴 Now, 2026-08-19. Owner-approved after dry-run review
// (scripts/dryrun-food-grocery-sweep.ts) — mid-flow rows (Whole Foods
// Market cmruuzq6z, Amazon Fresh cms2lbw7j) reconfirmed for delete,
// reminder-orphaning accepted with no cleanup step.
//
// Re-validates against the exact approved dry-run counts before writing
// anything — aborts loudly on any drift instead of silently applying a
// different set of writes than what was reviewed. Idempotent: skips
// Emails that already have junkedAt set, skips Orders that no longer
// exist. Single transaction: Email.junkedAt updates + Order deletes
// together — Order's FK to Email/Reminder/TokenRedemption/ActionLog is
// ON DELETE SET NULL (confirmed against migration SQL), so deleting the
// Order automatically orphans those rows, no manual unlink needed.
//
// Usage: npx tsx scripts/apply-food-grocery-sweep.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { extractDomain, isFoodGroceryDomain, isFoodGroceryRetailer } from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

// Exactly the counts the owner approved after dry-run review (2026-08-19).
const EXPECTED_EMAILS_TO_JUNK = 10;
const EXPECTED_ORDERS_TO_DELETE = 4;
const EXPECTED_MID_FLOW_ORDER_IDS = ["cmruuzq6z0003jx04yy5dogqv", "cms2lbw7j0009w9mqt8cghqni"];

async function main() {
  console.log("=== Food + grocery delivery exclusion — Step 2 APPLY ===\n");

  const allEmails = await prisma.email.findMany({
    select: { id: true, fromEmail: true, retailer: true, orderId: true, junkedAt: true },
  });

  const decorated = allEmails.map((e) => {
    let domain = "";
    try {
      domain = extractDomain(decrypt(e.fromEmail));
    } catch {
      domain = "";
    }
    return { ...e, domain };
  });

  const matched = decorated.filter((e) => isFoodGroceryDomain(e.domain) || isFoodGroceryRetailer(e.retailer));
  const toJunk = matched.filter((e) => e.junkedAt == null);

  const matchedOrderIds = [...new Set(toJunk.map((e) => e.orderId).filter((id): id is string => id != null))];
  const ordersToDelete = await prisma.order.findMany({
    where: { id: { in: matchedOrderIds } },
    include: { reminders: { select: { id: true } } },
  });

  // ---------- Safety gate: re-validate against the approved dry-run ----------
  const foundMidFlowIds = EXPECTED_MID_FLOW_ORDER_IDS.filter((id) => ordersToDelete.some((o) => o.id === id));
  const deviations: string[] = [];
  if (toJunk.length !== EXPECTED_EMAILS_TO_JUNK) {
    deviations.push(`Emails to junk: got ${toJunk.length}, expected ${EXPECTED_EMAILS_TO_JUNK}`);
  }
  if (ordersToDelete.length !== EXPECTED_ORDERS_TO_DELETE) {
    deviations.push(`Orders to delete: got ${ordersToDelete.length}, expected ${EXPECTED_ORDERS_TO_DELETE}`);
  }
  if (foundMidFlowIds.length !== EXPECTED_MID_FLOW_ORDER_IDS.length) {
    deviations.push(`Mid-flow orders: found ${foundMidFlowIds.join(", ") || "none"}, expected both ${EXPECTED_MID_FLOW_ORDER_IDS.join(", ")}`);
  }

  if (deviations.length > 0) {
    console.error("*** ABORTED — live state has drifted from the approved dry-run. No writes made. ***");
    for (const d of deviations) console.error(`  ${d}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Pre-flight check passed: ${toJunk.length} Emails to junk, ${ordersToDelete.length} Orders to delete, both mid-flow rows present.\n`);

  const remindersOrphanedCount = ordersToDelete.reduce((sum, o) => sum + o.reminders.length, 0);

  // ---------- Execute: one transaction, updates then deletes ----------
  const now = new Date();
  const results = await prisma.$transaction([
    ...toJunk.map((e) => prisma.email.update({ where: { id: e.id }, data: { junkedAt: now } })),
    ...ordersToDelete.map((o) => prisma.order.delete({ where: { id: o.id } })),
  ]);

  const emailsJunked = results.slice(0, toJunk.length).length;
  const ordersDeleted = results.slice(toJunk.length).length;

  console.log("=== APPLIED ===");
  console.log(`Emails junked: ${emailsJunked}`);
  console.log(`Orders deleted: ${ordersDeleted}`);
  for (const o of ordersToDelete) {
    console.log(`  deleted Order ${o.id} (retailer=${o.retailer ?? "null"}, ${o.reminders.length} reminder(s) orphaned)`);
  }
  console.log(`Reminders orphaned (orderId -> null via ON DELETE SET NULL): ${remindersOrphanedCount}`);

  // ---------- Post-write verification ----------
  const stillUnjunked = await prisma.email.count({
    where: { id: { in: toJunk.map((e) => e.id) }, junkedAt: null },
  });
  const stillExisting = await prisma.order.count({ where: { id: { in: ordersToDelete.map((o) => o.id) } } });
  console.log(`\nVerification: ${stillUnjunked} of the ${toJunk.length} target Emails still show junkedAt: null (expect 0).`);
  console.log(`Verification: ${stillExisting} of the ${ordersToDelete.length} target Orders still exist (expect 0).`);

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

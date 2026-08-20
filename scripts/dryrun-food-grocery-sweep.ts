// Food + grocery delivery exclusion — Step 2 historical sweep, DRY RUN ONLY.
// TASKS.md 🔴 Now, 2026-08-18/19. READ-ONLY — zero writes, zero Anthropic
// calls. Recomputes the Step 0 census live (not from the cached report) so
// any drift since census approval is caught, not assumed away.
//
// Sweep rule: match sender domain (FOOD_GROCERY_SENDER_DOMAINS) or
// Amazon-brand food retailer name (AMAZON_FOOD_RETAILER_NAMES) → set
// junkedAt. Idempotent: skip Emails that already have junkedAt set (never
// overwrite the timestamp); skip Orders that no longer exist. Any Order
// derived from a matched Email is deleted as a consequence (Email.orderId
// is ON DELETE SET NULL — confirmed against
// prisma/migrations/20260623024619_add_order_model/migration.sql — so the
// delete itself needs no manual unlink step; same for Reminder/
// TokenRedemption/ActionLog, all SET NULL per their migrations).
//
// Usage: npx tsx scripts/dryrun-food-grocery-sweep.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import {
  extractDomain,
  isFoodGroceryDomain,
  isFoodGroceryRetailer,
  FOOD_GROCERY_SENDER_DOMAINS,
  AMAZON_FOOD_RETAILER_NAMES,
} from "../lib/foodGroceryExclusion";

const prisma = new PrismaClient();

// Census baseline (owner-approved 2026-08-19) — any deviation from these is
// flagged loudly, not silently absorbed.
const EXPECTED_EMAILS_TO_JUNK = 11;
const EXPECTED_ORDERS_TO_DELETE = 4;
const EXPECTED_MID_FLOW_ORDER_IDS = ["cmruuzq6z0003jx04yy5dogqv", "cms2lbw7j0009w9mqt8cghqni"];

async function main() {
  console.log("=== Food + grocery delivery exclusion — Step 2 DRY RUN ===");
  console.log("READ-ONLY. Zero writes, zero Anthropic calls.\n");

  const allEmails = await prisma.email.findMany({
    select: { id: true, fromEmail: true, subject: true, retailer: true, orderId: true, junkedAt: true },
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

  const matched = decorated.filter(
    (e) => isFoodGroceryDomain(e.domain) || isFoodGroceryRetailer(e.retailer),
  );

  const toJunk = matched.filter((e) => e.junkedAt == null);
  const alreadyJunked = matched.filter((e) => e.junkedAt != null);

  console.log(`Matched Emails (sender-domain or retailer-backstop), full history: ${matched.length}`);
  console.log(`  Would junk (junkedAt currently null): ${toJunk.length}`);
  console.log(`  Skipped — already junked, idempotent no-op (junkedAt untouched): ${alreadyJunked.length}`);
  for (const e of alreadyJunked) {
    console.log(`    id=${e.id} junkedAt=${e.junkedAt?.toISOString()}`);
  }

  console.log("\n--- Per-domain / retailer breakdown (would-junk set only) ---");
  for (const d of FOOD_GROCERY_SENDER_DOMAINS) {
    const count = toJunk.filter((e) => isFoodGroceryDomain(e.domain) && e.domain.toLowerCase().endsWith(d)).length;
    if (count > 0) console.log(`  ${d}: ${count}`);
  }
  for (const r of AMAZON_FOOD_RETAILER_NAMES) {
    const count = toJunk.filter((e) => (e.retailer ?? "").toLowerCase() === r.toLowerCase()).length;
    if (count > 0) console.log(`  retailer="${r}": ${count}`);
  }

  // ---------- Orders that would be deleted ----------
  const matchedOrderIds = [...new Set(toJunk.map((e) => e.orderId).filter((id): id is string => id != null))];
  const orders = await prisma.order.findMany({
    where: { id: { in: matchedOrderIds } },
    include: {
      emails: { select: { id: true } },
      reminders: { select: { id: true, reminderType: true } },
    },
  });
  const foundOrderIds = new Set(orders.map((o) => o.id));
  const missingOrderIds = matchedOrderIds.filter((id) => !foundOrderIds.has(id));

  console.log(`\n=== Orders that would be deleted: ${orders.length} ===`);
  if (missingOrderIds.length > 0) {
    console.log(`  SKIPPED (already deleted / no longer exist — idempotent no-op): ${missingOrderIds.join(", ")}`);
  }

  for (const o of orders) {
    const isMidFlow = EXPECTED_MID_FLOW_ORDER_IDS.includes(o.id);
    const flag = isMidFlow ? "  [MID-FLOW — FLAGGED PER OWNER REQUEST]" : "";
    console.log(
      `  Order ${o.id} retailer=${o.retailer ?? "null"} status=${o.status} displayStatus=${o.displayStatus} linkedEmails=${o.emails.length} linkedReminders=${o.reminders.length}${flag}`,
    );
    if (isMidFlow) {
      console.log(`    ^ status=${o.status}, displayStatus=${o.displayStatus} — live, "trackable" state, not yet acted on by the user.`);
    }
    if (o.reminders.length > 0) {
      console.log(`    NOTE: ${o.reminders.length} Reminder row(s) reference this order (types: ${o.reminders.map((r) => r.reminderType).join(", ")}) — will be orphaned (orderId → null via ON DELETE SET NULL), not deleted themselves. Not resolved here, flagged only.`);
    }
  }

  // Confirm every FLAGGED mid-flow order from the owner's list is actually present.
  const missingFlagged = EXPECTED_MID_FLOW_ORDER_IDS.filter((id) => !foundOrderIds.has(id));
  if (missingFlagged.length > 0) {
    console.log(`\n  ANOMALY: expected mid-flow order(s) not found in the would-delete set: ${missingFlagged.join(", ")}`);
  }

  // ---------- Reconciliation against census baseline ----------
  console.log("\n=== Reconciliation against owner-approved Step 0 census ===");
  console.log(`Emails to junk: ${toJunk.length} (expected ~${EXPECTED_EMAILS_TO_JUNK})`);
  console.log(`Orders to delete: ${orders.length} (expected ${EXPECTED_ORDERS_TO_DELETE})`);

  const emailDeviation = toJunk.length !== EXPECTED_EMAILS_TO_JUNK;
  const orderDeviation = orders.length !== EXPECTED_ORDERS_TO_DELETE;

  if (emailDeviation || orderDeviation) {
    console.log("\n  *** DEVIATION FROM CENSUS — STOP, DO NOT APPLY WITHOUT RE-REVIEW ***");
    if (emailDeviation) console.log(`      Emails: got ${toJunk.length}, expected ~${EXPECTED_EMAILS_TO_JUNK}`);
    if (orderDeviation) console.log(`      Orders: got ${orders.length}, expected ${EXPECTED_ORDERS_TO_DELETE}`);
  } else {
    console.log("  Counts match the approved census exactly. No deviation.");
  }

  console.log("\nDone. Zero writes, zero Anthropic calls. This was a DRY RUN — nothing was junked or deleted.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// READ-ONLY recon for the 2026-09-21 uncertain_details backfill.
//
// No writes of any kind. No model calls. No policy lookups. Expected billed
// API count: 0.
//
// uncertain_details is a DERIVED reason, never stored: it is
// computeOrderReviewReason()'s catch-all tail (lib/orderReview.ts) —
// needsReview order, no [auto] retailer-prefix note, no linked email whose
// orderNumber matches a DIFFERENT order, orderDate non-null, orderTotal
// non-null. So this script imports that function and reproduces the
// dashboard's own queries exactly (app/(app)/needs-review/page.tsx) rather
// than reimplementing the predicate, which would be free to drift.
//
// candidateOrders is computed PER USER, matching the page: it is a
// per-session query there, and computing it globally would let one user's
// order numbers satisfy another user's belongs_to_existing_order branch.
//
// Usage:
//   npx tsx -r dotenv/config scripts/recon-uncertain-details-20260921.ts
import { PrismaClient } from "@prisma/client";
import { computeOrderReviewReason } from "../lib/orderReview";

const prisma = new PrismaClient();
const OWNER_EMAIL = "mckenna.sweazey@gmail.com";
const WINDOW_DAYS = 30;

function day(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function main() {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  let alphaIndex = 0;
  const labels = new Map<string, string>();
  for (const u of users) {
    labels.set(u.id, u.email === OWNER_EMAIL ? "OWNER" : `alpha-${++alphaIndex}`);
  }

  const inBucket: {
    label: string;
    id: string;
    retailer: string | null;
    orderNumber: string | null;
    createdAt: Date;
    inWindow: boolean;
    orderDate: Date | null;
    deliveryDate: Date | null;
    estimatedDeliveryDate: Date | null;
    deliveredAt: Date | null;
    returnDeadline: Date | null;
    returnWindowDays: number | null;
    policySource: string | null;
    emails: { id: string; emailType: string | null; anchorDate: Date | null; anchorSource: string | null }[];
  }[] = [];

  for (const user of users) {
    // Exactly the page's two queries, same filters.
    const [reviewOrders, candidateOrders] = await Promise.all([
      prisma.order.findMany({
        where: { userId: user.id, needsReview: true, archivedAt: null, deletedAt: null },
        include: { emails: { select: { orderNumber: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.order.findMany({
        where: { userId: user.id, archivedAt: null, deletedAt: null },
        select: { id: true, retailer: true, orderNumber: true, orderDate: true, orderTotal: true },
        orderBy: { orderDate: "desc" },
      }),
    ]);

    for (const order of reviewOrders) {
      const { reasonId } = computeOrderReviewReason(order, candidateOrders);
      if (reasonId !== "uncertain_details") continue;

      const emails = await prisma.email.findMany({
        where: { orderId: order.id },
        orderBy: { receivedAt: "asc" },
        select: { id: true, emailType: true, anchorDate: true, anchorSource: true },
      });

      inBucket.push({
        label: labels.get(user.id) ?? "?",
        id: order.id,
        retailer: order.retailer,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        inWindow: order.createdAt >= cutoff,
        orderDate: order.orderDate,
        deliveryDate: order.deliveryDate,
        estimatedDeliveryDate: order.estimatedDeliveryDate,
        deliveredAt: order.deliveredAt,
        returnDeadline: order.returnDeadline,
        returnWindowDays: order.returnWindowDays,
        policySource: order.policySource,
        emails,
      });
    }
  }

  const windowed = inBucket.filter((r) => r.inWindow);
  const older = inBucket.filter((r) => !r.inWindow);

  console.log(`uncertain_details rows total: ${inBucket.length}`);
  console.log(`  within last ${WINDOW_DAYS} days (backfill scope): ${windowed.length}`);
  console.log(`  older than ${WINDOW_DAYS} days (out of scope): ${older.length}\n`);

  for (const r of windowed) {
    const nullAnchors = r.emails.filter((e) => e.anchorDate == null);
    const flag = nullAnchors.length > 0 ? "  *** SKIP: null anchorDate ***" : "";
    console.log(`[${r.label}] ${r.retailer ?? "(no retailer)"}  #${r.orderNumber ?? "—"}${flag}`);
    console.log(`   order id        ${r.id}`);
    console.log(`   created         ${day(r.createdAt)}`);
    console.log(`   orderDate       ${day(r.orderDate)}`);
    console.log(`   deliveryDate    ${day(r.deliveryDate)}   estimated: ${day(r.estimatedDeliveryDate)}   deliveredAt: ${day(r.deliveredAt)}`);
    console.log(`   returnDeadline  ${day(r.returnDeadline)}   windowDays: ${r.returnWindowDays ?? "null"}   policySource: ${r.policySource ?? "null"}`);
    console.log(`   emails (${r.emails.length}):`);
    for (const e of r.emails) {
      console.log(`      ${e.id}  ${(e.emailType ?? "—").padEnd(22)} anchor: ${day(e.anchorDate)} (${e.anchorSource ?? "—"})`);
    }
    console.log("");
  }

  if (older.length > 0) {
    console.log("--- Out of scope (created >30d ago), listed for completeness only ---");
    for (const r of older) {
      console.log(`  [${r.label}] ${r.retailer ?? "(no retailer)"} #${r.orderNumber ?? "—"}  created ${day(r.createdAt)}  deliveryDate ${day(r.deliveryDate)}`);
    }
    console.log("");
  }

  const skips = windowed.filter((r) => r.emails.some((e) => e.anchorDate == null));
  const eligible = windowed.filter((r) => r.emails.every((e) => e.anchorDate != null) && r.emails.length > 0);
  const noEmails = windowed.filter((r) => r.emails.length === 0);

  console.log("--- Backfill eligibility ---");
  console.log(`  eligible (all emails have anchorDate): ${eligible.length}`);
  console.log(`  SKIP, null anchorDate on >=1 email:    ${skips.length}${skips.length ? " -> " + skips.map((r) => r.id).join(", ") : ""}`);
  console.log(`  SKIP, no linked emails at all:         ${noEmails.length}${noEmails.length ? " -> " + noEmails.map((r) => r.id).join(", ") : ""}`);
  console.log(`  total emails to re-extract:            ${eligible.reduce((n, r) => n + r.emails.length, 0)}`);

  const simplySimpson = inBucket.find((r) => r.orderNumber === "164649");
  console.log("\n--- Simply Simpson #164649 (Act 2 hand-verify target) ---");
  console.log(
    simplySimpson
      ? `  present in bucket: yes (${simplySimpson.id}), deliveryDate ${day(simplySimpson.deliveryDate)}, in 30d window: ${simplySimpson.inWindow}`
      : "  NOT in the uncertain_details bucket — investigate before proceeding",
  );
}

main()
  .catch((e) => {
    console.error("Recon failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

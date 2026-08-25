// PM design pre-code verification (2026-08-24): needs-review bucket
// routing-tree redesign. READ-ONLY — 0 writes, 0 Anthropic calls, no
// re-extraction. Companion artifact to NEEDS_REVIEW_ROUTING_DESIGN.md —
// read that doc for the reasoning; this script is the evidence.
//
// Reproduces the current CURRENT reason/action logic (copied verbatim from
// lib/needsReviewRows.ts + lib/needsReviewActions.ts, not imported — these
// scripts run outside Next's @/ alias resolution) side by side with the
// PROPOSED four-branch tree from the design doc, so the delta is visible
// per row before any code changes. Supersedes the exploratory
// scripts/pm-diag-needsreview-action-routing-20260824.ts (uncommitted,
// scratch) — this is the committed, durable version.
//
// Usage: npx tsx scripts/pm-design-needsreview-routing-tree-20260824.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CurrentReasonId = "belongs_to_existing_order" | "real_purchase_no_record";
type ProposedReasonId = "belongs_to_existing_order" | "return_or_refund_no_link" | "real_purchase_no_record" | "no_extraction_signal";

const PURCHASE_SIDE_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);
const RETURN_SIDE_TYPES = new Set(["return_label", "refund"]);

// --- CURRENT: copied verbatim from lib/needsReviewRows.ts's detectEmailReviewReason ---
function currentReason(
  email: { orderNumber: string | null },
  candidateOrders: { orderNumber: string | null }[]
): CurrentReasonId {
  if (email.orderNumber) {
    const normalized = email.orderNumber.toLowerCase();
    const matches = candidateOrders.some((o) => o.orderNumber && o.orderNumber.toLowerCase() === normalized);
    if (matches) return "belongs_to_existing_order";
  }
  return "real_purchase_no_record";
}

// --- CURRENT: copied verbatim from lib/needsReviewActions.ts's needsReviewAction (email-kind branch) ---
function currentAction(reasonId: string): string {
  if (reasonId === "belongs_to_existing_order" || reasonId === "duplicate") return "Merge with existing order";
  if (reasonId === "real_purchase_no_record") return "Start a new order";
  return "More info";
}

// --- PROPOSED: NEEDS_REVIEW_ROUTING_DESIGN.md's four-branch tree, priority order ---
function proposedReason(
  email: { orderNumber: string | null; retailer: string | null; emailType: string | null },
  candidateOrders: { orderNumber: string | null }[]
): ProposedReasonId {
  if (email.orderNumber) {
    const normalized = email.orderNumber.toLowerCase();
    const matches = candidateOrders.some((o) => o.orderNumber && o.orderNumber.toLowerCase() === normalized);
    if (matches) return "belongs_to_existing_order";
  }
  if (email.emailType && RETURN_SIDE_TYPES.has(email.emailType)) return "return_or_refund_no_link";
  const hasPurchaseSignal = email.emailType != null && PURCHASE_SIDE_TYPES.has(email.emailType) && (!!email.retailer || !!email.orderNumber);
  if (hasPurchaseSignal) return "real_purchase_no_record";
  return "no_extraction_signal";
}

// --- PROPOSED: action mapping for the two new/changed branches ---
function proposedAction(reasonId: ProposedReasonId): string {
  if (reasonId === "belongs_to_existing_order") return "Merge with existing order";
  if (reasonId === "return_or_refund_no_link") return "Merge with existing order"; // manual picker — see design doc
  if (reasonId === "real_purchase_no_record") return "Start a new order";
  return "More info"; // no_extraction_signal — degrade, per CARD_SPEC.md Part 3
}

async function main() {
  console.log("NEEDS-REVIEW ROUTING-TREE DESIGN VERIFICATION — READ ONLY. 0 writes, 0 Anthropic calls.\n");

  const owner = await prisma.user.findUnique({ where: { email: "mckenna.sweazey@gmail.com" }, select: { id: true, email: true } });
  if (!owner) throw new Error("owner not found by email — refusing to guess a userId");
  console.log(`Scoped to owner userId=${owner.id} (${owner.email})\n`);

  const [orphanedEmails, linkablePickerOrders] = await Promise.all([
    prisma.email.findMany({
      where: { orderId: null, userId: owner.id, junkedAt: null },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        retailer: true,
        receivedAt: true,
        orderTotal: true,
        orderCurrency: true,
        orderNumber: true,
        emailType: true,
        extractedAt: true,
      },
    }),
    prisma.order.findMany({
      where: { userId: owner.id, archivedAt: null, deletedAt: null },
      select: { id: true, retailer: true, orderNumber: true, orderDate: true },
    }),
  ]);

  const reviewOrders = await prisma.order.findMany({
    where: { userId: owner.id, needsReview: true, archivedAt: null, deletedAt: null },
    select: { id: true, retailer: true, orderNumber: true },
  });

  console.log(`Email-kind orphans: ${orphanedEmails.length}. Order-kind needs-review rows: ${reviewOrders.length}. Total: ${orphanedEmails.length + reviewOrders.length}.\n`);

  console.log("=== EMAIL-KIND ROWS: CURRENT vs PROPOSED ===");
  console.log("idx | retailer | orderNumber | emailType | current_reason | current_action | proposed_reason | proposed_action | CHANGED?");

  let changedCount = 0;
  const rows = orphanedEmails.map((email, idx) => {
    const curReason = currentReason(email, linkablePickerOrders);
    const curAction = currentAction(curReason);
    const propReason = proposedReason(email, linkablePickerOrders);
    const propAction = proposedAction(propReason);
    const changed = curAction !== propAction;
    if (changed) changedCount++;
    return { idx, email, curReason, curAction, propReason, propAction, changed };
  });

  for (const r of rows) {
    const e = r.email;
    console.log(
      `${r.idx} | ${e.retailer ?? "null"} | ${e.orderNumber ?? "null"} | ${e.emailType ?? "null"} | ` +
        `${r.curReason} | ${r.curAction} | ${r.propReason} | ${r.propAction} | ${r.changed ? "YES" : "no"}`
    );
  }

  console.log(`\n${changedCount} of ${rows.length} email-kind rows change action under the proposed tree.\n`);

  console.log("=== PROPOSED ACTION DISTRIBUTION (email-kind) ===");
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.propAction, (dist.get(r.propAction) ?? 0) + 1);
  for (const [action, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${action}: ${count}`);
  }

  console.log("\n=== ORDER-KIND ROWS (unchanged by this design — kind===\"order\" always degrades to View detail, per lib/needsReviewActions.ts:43-44, a separate deferred decision) ===");
  for (const o of reviewOrders) {
    console.log(`  orderId=${o.id} retailer=${o.retailer} orderNumber=${o.orderNumber} action=More info (unchanged)`);
  }

  console.log("\n=== NOTE: emailType return_label/refund among current orphans ===");
  const returnSideOrphans = rows.filter((r) => r.email.emailType && RETURN_SIDE_TYPES.has(r.email.emailType));
  console.log(
    `  ${returnSideOrphans.length} of ${rows.length} current orphans have emailType in {return_label, refund} — the ` +
      `return_or_refund_no_link branch exists for future orphans of this shape (e.g. a repeat of the original H&M case), ` +
      `not because it changes any row in today's snapshot.`
  );

  console.log("\nDone. 0 writes, 0 Anthropic calls, no re-extraction.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

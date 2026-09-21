// Validation harness for the 2026-09-21 Act 2 arc (Fix A: anchorDate in the
// extraction prompt; Fix B: ANCHOR_DATE_RESOLVER.md Part 3 sanity guard).
//
// Purpose: catch prompt-drift regressions from Fix A by re-extracting a
// batch of past emails with the new prompt and diffing against what each
// row currently stores.
//
// SCOPE — deliberately narrow:
//   * Calls extractEmailIdentity ONLY, never finalizeExtraction. Fix A's
//     change lives entirely in the raw extraction prompt, and Fix B's guard
//     is a pure function applied locally below. Routing through
//     finalizeExtraction would fire a billed web-search policy lookup per
//     row with no stated window — ~50 searches against real retailers, on
//     the exact path the 2026-09-21 H&M incident showed producing
//     wrong-and-confident answers. Not worth it to test a prompt change.
//   * READ-ONLY. No prisma.*.update/create/delete anywhere in this file.
//     This is a dry-run comparison, NOT a backfill.
//
// COMPARABILITY — important when reading the output:
//   Stored Email fields are post-finalizeExtraction, so returnWindowDays /
//   returnWindowStartsFrom / needsReview on a row may reflect a web lookup
//   or JS-side triggers that this harness never runs. Those three are
//   reported separately and only treated as comparable where the stored
//   policySource is "email" (the window genuinely came from the body).
//   Everything in COMPARABLE_FIELDS below is pure AI output on both sides.
//
// Usage:
//   npx tsx scripts/validate-anchor-prompt-20260921.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { resolveBodyTextWithAlternate } from "../lib/emailBodyText";
import { extractEmailIdentity, routeDeliveryDate, resolveEstimatedDeliveryDate, applyAnchorYearGuard } from "../lib/extract";

const prisma = new PrismaClient();

const NEEDS_REVIEW_TARGET = 24;
const KNOWN_GOOD_TARGET = 25;
const NULL_ANCHOR_CONTROL_TARGET = 3;

// Pure AI-output fields — identical contract on both sides of the diff.
const COMPARABLE_FIELDS = [
  "emailType",
  "retailer",
  "orderNumber",
  "orderDate",
  "deliveryDate",
  "orderTotal",
  "orderCurrency",
  "confidence",
] as const;

const SELECT = {
  id: true,
  subject: true,
  textBody: true,
  htmlBody: true,
  anchorDate: true,
  anchorSource: true,
  needsReview: true,
  emailType: true,
  retailer: true,
  orderNumber: true,
  orderDate: true,
  deliveryDate: true,
  orderTotal: true,
  orderCurrency: true,
  confidence: true,
  lineItems: true,
  returnWindowDays: true,
  returnWindowStartsFrom: true,
  policySource: true,
} as const;

// Exact billed-token accounting: logAnthropicUsage emits a JSON line per
// billed call. Intercept rather than estimate.
let apiCalls = 0;
let inputTokens = 0;
let outputTokens = 0;
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.includes("anthropic_usage")) {
    try {
      const match = first.match(/\{[\s\S]*\}/);
      if (match) {
        const event = JSON.parse(match[0]);
        apiCalls += 1;
        inputTokens += event.inputTokens ?? 0;
        outputTokens += event.outputTokens ?? 0;
      }
    } catch {
      /* usage line unparseable — counted below by call count only */
    }
    return; // suppress: keeps the diff output readable
  }
  originalLog(...args);
};

function asIsoDay(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

function normalize(field: string, value: unknown): string | null {
  if (value == null) return null;
  if (field === "orderDate" || field === "deliveryDate") return asIsoDay(value);
  if (field === "orderTotal") return Number(value).toFixed(2);
  return String(value);
}

function lineItemCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function main() {
  const base = { junkedAt: null, extractedAt: { not: null } } as const;

  const needsReviewRows = await prisma.email.findMany({
    where: { ...base, needsReview: true, anchorDate: { not: null } },
    select: SELECT,
    orderBy: { receivedAt: "desc" },
    take: NEEDS_REVIEW_TARGET,
  });
  const knownGoodRows = await prisma.email.findMany({
    where: { ...base, needsReview: false, anchorDate: { not: null } },
    select: SELECT,
    orderBy: { receivedAt: "desc" },
    take: KNOWN_GOOD_TARGET,
  });
  // Controls: unresolved manual forwards. Fix A emits no date line and the
  // Fix B guard declines to act — these must come back unchanged.
  const nullAnchorRows = await prisma.email.findMany({
    where: { ...base, anchorDate: null },
    select: SELECT,
    orderBy: { receivedAt: "desc" },
    take: NULL_ANCHOR_CONTROL_TARGET,
  });

  const batch = [
    ...needsReviewRows.map((r) => ({ row: r, cohort: "needs-review" })),
    ...knownGoodRows.map((r) => ({ row: r, cohort: "known-good" })),
    ...nullAnchorRows.map((r) => ({ row: r, cohort: "null-anchor-control" })),
  ];

  originalLog(
    `Batch: ${batch.length} rows (${needsReviewRows.length} needs-review, ${knownGoodRows.length} known-good, ${nullAnchorRows.length} null-anchor controls)\n`,
  );

  const fieldChanges: Record<string, { from: string | null; to: string | null; id: string; cohort: string }[]> = {};
  const confidenceShifts: { id: string; from: string | null; to: string | null; cohort: string }[] = [];
  const guardActions: { id: string; corrected: string[]; unresolved: string[]; note: string | null }[] = [];
  const windowNotes: { id: string; storedPolicySource: string | null; storedDays: number | null; newDays: number | null }[] = [];
  const controlChanged: string[] = [];
  const failures: { id: string; error: string }[] = [];
  let processed = 0;

  for (const { row, cohort } of batch) {
    const textBody = row.textBody ? decrypt(row.textBody) : null;
    const htmlBody = row.htmlBody ? decrypt(row.htmlBody) : null;
    const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);
    if (!primary) {
      failures.push({ id: row.id, error: "no body text" });
      continue;
    }

    let parsed;
    try {
      parsed = await extractEmailIdentity(primary, row.subject ?? null, row.id, alternate, row.anchorDate);
    } catch (error) {
      // Stop rather than retry blindly (owner instruction 2026-09-21).
      originalLog(`\nFAILED on ${row.id} after ${processed} rows: ${String(error)}`);
      failures.push({ id: row.id, error: String(error) });
      break;
    }
    processed += 1;

    let rowChanged = false;
    for (const field of COMPARABLE_FIELDS) {
      const before = normalize(field, (row as Record<string, unknown>)[field]);
      const after = normalize(field, (parsed as unknown as Record<string, unknown>)[field]);
      if (before !== after) {
        rowChanged = true;
        (fieldChanges[field] ??= []).push({ from: before, to: after, id: row.id, cohort });
        if (field === "confidence") confidenceShifts.push({ id: row.id, from: before, to: after, cohort });
      }
    }

    const beforeItems = lineItemCount(row.lineItems);
    const afterItems = lineItemCount(parsed.lineItems);
    if (beforeItems !== afterItems) {
      rowChanged = true;
      (fieldChanges["lineItems(count)"] ??= []).push({
        from: String(beforeItems),
        to: String(afterItems),
        id: row.id,
        cohort,
      });
    }

    // Fix B applied locally, same order finalizeExtraction applies it.
    const routed = routeDeliveryDate(parsed.emailType, parsed.deliveryDate);
    const estimate = resolveEstimatedDeliveryDate(routed.estimatedDeliveryDate, parsed.shipByDate);
    const guarded = applyAnchorYearGuard(
      { orderDate: parsed.orderDate, estimatedDeliveryDate: estimate, deliveredAt: routed.deliveredAt },
      row.anchorDate,
    );
    if (guarded.correctedFields.length > 0 || guarded.unresolvedFields.length > 0) {
      guardActions.push({
        id: row.id,
        corrected: guarded.correctedFields,
        unresolved: guarded.unresolvedFields,
        note: guarded.note,
      });
    }

    if (row.returnWindowDays !== parsed.returnWindowDays) {
      windowNotes.push({
        id: row.id,
        storedPolicySource: row.policySource,
        storedDays: row.returnWindowDays,
        newDays: parsed.returnWindowDays,
      });
    }

    if (cohort === "null-anchor-control" && rowChanged) controlChanged.push(row.id);
    process.stderr.write(`\r  ${processed}/${batch.length} rows…`);
  }

  originalLog("\n\n========== DIFF SUMMARY ==========\n");
  originalLog(`Rows processed: ${processed}/${batch.length}`);
  if (failures.length > 0) originalLog(`Failures: ${JSON.stringify(failures, null, 2)}`);

  originalLog("\n--- Comparable AI fields that changed ---");
  const changedFieldNames = Object.keys(fieldChanges);
  if (changedFieldNames.length === 0) {
    originalLog("  (none — every comparable field identical across all rows)");
  } else {
    for (const field of changedFieldNames) {
      const entries = fieldChanges[field];
      const newNonNull = entries.filter((e) => e.from == null && e.to != null).length;
      const newNull = entries.filter((e) => e.from != null && e.to == null).length;
      const altered = entries.length - newNonNull - newNull;
      originalLog(`  ${field}: ${entries.length} changed (${newNonNull} null→value, ${newNull} value→null, ${altered} value→value)`);
      for (const e of entries) originalLog(`      [${e.cohort}] ${e.id}: ${e.from} → ${e.to}`);
    }
  }

  originalLog("\n--- Confidence shifts ---");
  originalLog(confidenceShifts.length === 0 ? "  (none)" : JSON.stringify(confidenceShifts, null, 2));

  originalLog("\n--- Fix B guard actions ---");
  originalLog(guardActions.length === 0 ? "  (none fired)" : JSON.stringify(guardActions, null, 2));

  originalLog("\n--- returnWindowDays (NOT directly comparable: stored may include web lookup) ---");
  if (windowNotes.length === 0) {
    originalLog("  (none differ)");
  } else {
    const fromEmail = windowNotes.filter((w) => w.storedPolicySource === "email");
    originalLog(`  ${windowNotes.length} differ; ${fromEmail.length} where stored policySource="email" (genuinely comparable):`);
    originalLog(JSON.stringify(fromEmail, null, 2));
  }

  originalLog("\n--- Null-anchor controls ---");
  originalLog(
    controlChanged.length === 0
      ? `  ${nullAnchorRows.length} control rows, all unchanged (expected: Fix A emits no date line, guard declines)`
      : `  CHANGED: ${controlChanged.join(", ")}`,
  );

  const cost = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  originalLog("\n--- Billed API usage (measured, not estimated) ---");
  originalLog(`  calls: ${apiCalls}  input: ${inputTokens}  output: ${outputTokens}`);
  originalLog(`  cost: $${cost.toFixed(4)} (Sonnet 4.6 @ $3/$15 per MTok)`);
  originalLog("  web searches fired: 0 (finalizeExtraction never called)");
}

main()
  .catch((e) => {
    originalLog("Harness aborted:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

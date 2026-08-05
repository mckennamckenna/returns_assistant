// DATA REPAIR — spends real money. Re-extracts the emailType:null rows
// from the 2026-08-01T12:08:00Z (13:08 BST) credit-outage window,
// approved by the owner 2026-08-04 at the Phase A count of 104
// (TASKS.md 🔴 Now). Reuses runExtraction() directly — same path a real
// inbound email takes — so re-extracted rows get identical treatment
// (the live "other" gate, usage logging, linking).
//
// Idempotent + target-only: re-queries the same failure-state filter
// fresh at start (not a hardcoded id list) so a partial/interrupted run
// can simply be re-invoked — already-repaired rows fall out of the filter
// on their own. Hard-stops before spending anything if the fresh count
// doesn't match the approved 104, since that means the world changed
// since Phase A and needs a fresh look, not a silent proceed.
//
// Deliberately excludes:
//   - the 12 known 2026-07-21 rows (ACE VISALIA RSC / GLOBAL-E NL B.V.
//     redelivery-duplicate cluster, already tracked separately)
//   - the 1 isolated 2026-07-28T17:46:26 row (no adjacent failures, not
//     part of this outage)
//   - the 18 rows 2026-07-31T18:01:30Z–2026-08-01T04:56:06Z (the
//     pre-bound cluster flagged in the Phase A report — owner approved
//     the STATED 104, not the widened 122, for this run)
//
// Usage: npx tsx scripts/reextract-aug-outage-orphans.ts
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();

const OUTAGE_START = new Date("2026-08-01T12:08:00.000Z");
const APPROVED_COUNT = 104;
// Mathematical ceiling, not a normal-operation limiter: each email can
// trigger at most 1 extraction + 1 policy lookup, so 104 emails can never
// legitimately bill more than 208 calls. Tripping this means something is
// re-processing rows or looping, not just "the lookup rate was higher than
// the 70% precedent" — that alone can never reach this number.
const STOP_THRESHOLD = 208;

// Known-problematic row, isolated deliberately (2026-08-05): its
// lookupReturnPolicy("Suzie Kondi") call has hung near the Anthropic SDK's
// default timeout twice in a row, which is long enough for Neon's
// serverless compute to auto-suspend mid-stall and wedge this process's
// remaining DB connections for every row after it. Excluded here so it
// can't keep taking the rest of the batch down with it — see the session
// report for the root-cause flag (a bounded per-call timeout in
// lib/extract.ts would fix this properly, but that's a production code
// change needing sign-off, not something to slip into a backfill script).
const SKIP_IDS = new Set(["cmsdunton0001gt04vm8msv9m"]);

async function main() {
  const target = (
    await prisma.email.findMany({
      where: {
        receivedAt: { gte: OUTAGE_START },
        emailType: null,
        OR: [{ extractedAt: { not: null } }, { extractedAt: null }],
      },
      select: { id: true, receivedAt: true },
      orderBy: { receivedAt: "asc" },
    })
  ).filter((e) => !SKIP_IDS.has(e.id));

  console.log(`Fresh pre-check: found ${target.length} row(s) still emailType:null at/after ${OUTAGE_START.toISOString()}.`);
  if (target.length > APPROVED_COUNT) {
    console.log(
      `\n⚠️  MISMATCH: approved ceiling was ${APPROVED_COUNT}, fresh query found ${target.length} — MORE than approved. ` +
        `Stopping WITHOUT spending anything — that means new failures joined the set since Phase A approval and needs a fresh look, not a silent proceed.`,
    );
    return;
  }
  if (target.length < APPROVED_COUNT) {
    console.log(
      `Note: fewer than the originally-approved ${APPROVED_COUNT} (this is a resume after an earlier interrupted run — ` +
        `already-repaired rows correctly fell out of this fresh query). Proceeding on the ${target.length} still remaining.`,
    );
  } else {
    console.log(`Count matches the approved ${APPROVED_COUNT}.`);
  }
  console.log("Beginning sequential re-extraction.\n");

  // Capture every anthropic_usage log line (email_extraction + policy_lookup)
  // emitted by the real logging path — this is also the authoritative count
  // of actually-billed calls (a call that errors before a response is
  // received never reaches the log line, so it was never billed).
  const usageEvents: Record<string, unknown>[] = [];
  const origConsoleLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === "string" && msg.startsWith('{"event":"anthropic_usage"')) {
      try {
        usageEvents.push(JSON.parse(msg));
      } catch {
        // malformed line — still forward it below, just don't count it
      }
    }
    origConsoleLog(...args);
  };

  let lastLookupErrorCapture: string | null = null;
  const origConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("Return policy web lookup failed")) lastLookupErrorCapture = msg;
    origConsoleError(...args);
  };

  const results: {
    id: string;
    receivedAt: string;
    after: {
      emailType: string | null;
      retailer: string | null;
      orderNumber: string | null;
      orderId: string | null;
      needsReview: boolean;
      policySource: string | null;
    };
    lookupAttempted: "web_lookup_success" | "web_lookup_unclear" | "web_lookup_error" | "none";
  }[] = [];

  let stoppedEarly = false;

  for (let i = 0; i < target.length; i++) {
    const { id } = target[i];

    if (usageEvents.length >= STOP_THRESHOLD) {
      origConsoleLog(
        `\n⚠️  STOP THRESHOLD (${STOP_THRESHOLD} billed calls) reached after ${i}/${target.length} rows. ` +
          `Stopping early rather than continuing past it — this should be mathematically impossible under normal operation.`,
      );
      stoppedEarly = true;
      break;
    }

    lastLookupErrorCapture = null;
    let after;
    try {
      await runExtraction(id);
      after = await prisma.email.findUnique({
        where: { id },
        select: {
          receivedAt: true,
          emailType: true,
          retailer: true,
          orderNumber: true,
          orderId: true,
          needsReview: true,
          policySource: true,
          extractionNotes: true,
        },
      });
    } catch (error) {
      // Isolate one row's failure (e.g. a dropped DB connection, P1017)
      // from the rest of the batch — this row simply stays emailType:null
      // and will be picked up by a subsequent resume run, same as any
      // other still-failing row. Never lets one transient error abort
      // otherwise-successful remaining rows.
      origConsoleError(`Row ${id} threw outside runExtraction's own handling, skipping and continuing:`, error);
      continue;
    }
    if (!after) continue;

    let lookupAttempted: (typeof results)[number]["lookupAttempted"] = "none";
    if (after.policySource === "web_lookup") lookupAttempted = "web_lookup_success";
    else if (after.extractionNotes?.includes("Web lookup for return policy was unclear")) lookupAttempted = "web_lookup_unclear";
    else if (lastLookupErrorCapture) lookupAttempted = "web_lookup_error";

    results.push({
      id,
      receivedAt: after.receivedAt.toISOString(),
      after: {
        emailType: after.emailType,
        retailer: after.retailer,
        orderNumber: after.orderNumber,
        orderId: after.orderId,
        needsReview: after.needsReview,
        policySource: after.policySource,
      },
      lookupAttempted,
    });

    origConsoleLog(
      `[${i + 1}/${target.length}] ${id} -> emailType=${after.emailType ?? "STILL NULL"} retailer=${after.retailer ?? "null"} orderId=${after.orderId ?? "null"} lookup=${lookupAttempted}`,
    );
  }

  console.log = origConsoleLog;
  console.error = origConsoleError;

  const extractionEvents = usageEvents.filter((e) => e.callSite === "email_extraction");
  const lookupEvents = usageEvents.filter((e) => e.callSite === "policy_lookup");

  console.log("\n=== SUMMARY ===");
  console.log(`Stopped early: ${stoppedEarly}`);
  console.log(`Rows processed: ${results.length} / ${target.length}`);
  console.log(`Repaired (emailType now populated): ${results.filter((r) => r.after.emailType !== null).length}`);
  console.log(`Still null after re-extraction attempt: ${results.filter((r) => r.after.emailType === null).length}`);
  console.log(`Orders created/linked (orderId now set): ${results.filter((r) => r.after.orderId !== null).length}`);
  console.log(`\nBilled calls — email_extraction: ${extractionEvents.length}, policy_lookup: ${lookupEvents.length}, TOTAL: ${usageEvents.length}`);
  console.log(`Policy lookups with webSearchRequests > 0: ${lookupEvents.filter((e) => (e.webSearchRequests as number) > 0).length} / ${lookupEvents.length}`);

  if (lookupEvents.length > 0) {
    console.log("\n=== SAMPLE policy_lookup anthropic_usage LINE ===");
    console.log(JSON.stringify(lookupEvents[0]));
  } else {
    console.log("\nNo policy_lookup events fired — nothing to sample.");
  }

  console.log("\n=== PER-ROW DETAIL ===");
  for (const r of results) {
    console.log(
      `${r.id} | ${r.receivedAt} | emailType=${r.after.emailType ?? "STILL NULL"} | retailer=${r.after.retailer ?? "null"} | orderNumber=${r.after.orderNumber ?? "null"} | orderId=${r.after.orderId ?? "null"} | needsReview=${r.after.needsReview} | lookup=${r.lookupAttempted}`,
    );
  }

  const stillNull = results.filter((r) => r.after.emailType === null);
  if (stillNull.length > 0) {
    console.log("\n=== STILL-NULL ROWS (real residue — genuinely failed again, not outage scar) ===");
    for (const r of stillNull) console.log(`  ${r.id} (${r.receivedAt})`);
  }

  const last7Days = results.filter((r) => Date.now() - new Date(r.receivedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  console.log(`\nRe-extracted rows within the last 7 days (will appear in this Friday's coverage-check — expected): ${last7Days.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

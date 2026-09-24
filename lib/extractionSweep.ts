import { prisma } from "@/lib/db";
import { runExtraction } from "@/lib/runExtraction";
import { notifyAdmin } from "@/lib/adminNotify";
import { WORST_CASE_EXTRACTION_MS } from "@/lib/extract";

// --- Extraction recovery sweep ---------------------------------------------
// Backstop for BOTH routes to the "stored but never read" bug (TASKS.md
// 2026-09-23 findings, 2026-09-24 build):
//   (a) runExtraction's catch block double-fails (Neon P1017) and the second
//       exception escapes through the inbound route's console.error-only
//       handler, leaving the row at pure Prisma defaults;
//   (b) a model call runs past the platform's function limit and the whole
//       invocation is killed before EITHER extractedAt write lands.
// Either way the email ends up extractedAt: null, needsReview: false,
// orderId: null — indistinguishable from "never called," invisible in the
// needs-review queue, and with nothing retrying it.
//
// This does not FIX either route. It guarantees such a row is retried once
// and, if it stays broken, surfaced to the owner instead of sitting silent.

// Runs ONCE A DAY: the hosting plan's cron minimum interval is daily, with
// per-hour precision (fires at some point within the scheduled hour). The
// schedule itself lives in vercel.json — that entry plus this constant are
// the only two places to touch if the cadence ever gets tighter.
export const SWEEP_MAX_EMAILS_PER_RUN = 3;

// How long an email must have sat unextracted before the sweep will touch
// it. Comfortably past a healthy extraction (measured floor ~12-15s without
// a lookup, ~37-40s with one) so the sweep can never race an in-flight
// attempt and double-extract.
export const SWEEP_MIN_AGE_MINUTES = 20;

// Only emails that arrive AFTER this build deploys are covered. The 6
// pre-existing stuck rows (3 Simply Simpson, Shutterfly 08-31, Factor
// 09-05, 1 older Amazon) are handled by hand — owner decision, so that
// re-extracting the Simply Simpson rows stays available as the live
// verification of the lookup timeout. Deliberately a constant, not a
// migration.
export const SWEEP_COVERAGE_START = new Date("2026-09-24T00:00:00.000Z");

export const EXTRACTION_RETRY_ACTION = "extraction_retry";
export const RETRY_OUTCOME_STARTED = "started";
export const RETRY_OUTCOME_SUCCESS = "success";
export const RETRY_OUTCOME_STILL_UNEXTRACTED = "still_unextracted";

// The platform kills the function at this point; every budget below is
// measured against it. Mirrors the `maxDuration` exported by each route.
export const MAX_DURATION_MS = 300_000;

// Reserve for the work that happens AFTER the last email is processed —
// the interrupted-row query and the admin notification (a Postmark send
// plus an AdminNotification write). Without this the run could spend its
// entire budget extracting and get killed before it could report anything.
const WRAP_UP_RESERVE_MS = 15_000;

// Only start another email if the WHOLE worst case still fits. Derived from
// the timeout constants in lib/extract.ts rather than hardcoded, so it can
// never drift out of sync with them.
//
// This is the fix for the flaw the owner caught in the first draft: a naive
// "stop if under 120s left" guard could start an email whose worst case is
// ~240s, get killed mid-retry, and strand its ActionLog row at "started"
// forever — never retried (the row exists, so it's ineligible), never
// reported. That is the original silent failure, reproduced inside the
// thing built to prevent it.
export function hasBudgetForAnotherEmail(elapsedMs: number): boolean {
  return elapsedMs + WORST_CASE_EXTRACTION_MS + WRAP_UP_RESERVE_MS <= MAX_DURATION_MS;
}

export interface SweepResult {
  candidatesFound: number;
  attempted: number;
  succeeded: string[];
  stillUnextracted: string[];
  interrupted: string[];
  skippedForBudget: number;
}

export async function runExtractionSweep(now: Date = new Date()): Promise<SweepResult> {
  const startedAt = Date.now();
  const cutoff = new Date(now.getTime() - SWEEP_MIN_AGE_MINUTES * 60 * 1000);

  // Eligibility. `actionLogs: { none: ... }` is the one-retry-ever guarantee
  // at the query level: any extraction_retry row at all — whatever its
  // outcome, including a stranded "started" — makes the email ineligible
  // forever. There is no path that retries the same email twice.
  const candidates = await prisma.email.findMany({
    where: {
      extractedAt: null,
      junkedAt: null,
      receivedAt: { lt: cutoff, gte: SWEEP_COVERAGE_START },
      actionLogs: { none: { action: EXTRACTION_RETRY_ACTION } },
    },
    orderBy: { receivedAt: "asc" },
    take: SWEEP_MAX_EMAILS_PER_RUN,
    select: { id: true, userId: true },
  });

  const succeeded: string[] = [];
  const stillUnextracted: string[] = [];
  let attempted = 0;
  let skippedForBudget = 0;

  for (const email of candidates) {
    // Defence in depth. The query's `take` already caps this, but the cap
    // is a safety property of the RUN, not of one query — it must hold
    // even if the query is ever changed, paginated, or called with a
    // different limit. Enforced here so the invariant lives with the
    // budget logic it protects.
    if (attempted >= SWEEP_MAX_EMAILS_PER_RUN) {
      skippedForBudget += 1;
      continue;
    }

    if (!hasBudgetForAnotherEmail(Date.now() - startedAt)) {
      // Leftovers wait for the next run rather than being started and
      // killed halfway.
      skippedForBudget += 1;
      continue;
    }

    // Written BEFORE the attempt, never after. If this invocation dies
    // mid-extraction, the row survives and permanently disqualifies the
    // email from a second automatic retry. An after-the-fact write would
    // leave a killed retry looking untried and loop forever.
    const log = await prisma.actionLog.create({
      data: {
        action: EXTRACTION_RETRY_ACTION,
        outcome: RETRY_OUTCOME_STARTED,
        emailId: email.id,
        userId: email.userId,
      },
    });

    attempted += 1;
    const attemptStart = Date.now();
    try {
      await runExtraction(email.id);
    } catch (error) {
      // runExtraction handles its own errors; this only catches the case
      // where it throws anyway (the double-failure route (a) above). Either
      // way the outcome is decided by re-reading the row, below.
      console.error("extraction-sweep: runExtraction threw for", email.id, error);
    }
    const durationMs = Date.now() - attemptStart;

    const after = await prisma.email.findUnique({
      where: { id: email.id },
      select: { extractedAt: true },
    });
    const worked = after?.extractedAt != null;
    (worked ? succeeded : stillUnextracted).push(email.id);

    await prisma.actionLog.update({
      where: { id: log.id },
      data: {
        outcome: `${worked ? RETRY_OUTCOME_SUCCESS : RETRY_OUTCOME_STILL_UNEXTRACTED}:${durationMs}ms`,
      },
    });
  }

  // Rows stranded at "started" by an earlier run that was killed before it
  // could record an outcome. They are already ineligible for another
  // automatic retry, so without this they would never be mentioned again —
  // exactly the silence this whole build exists to remove.
  const interruptedRows = await prisma.actionLog.findMany({
    where: { action: EXTRACTION_RETRY_ACTION, outcome: RETRY_OUTCOME_STARTED, emailId: { not: null } },
    select: { emailId: true },
  });
  const interrupted = interruptedRows
    .map((r) => r.emailId)
    .filter((id): id is string => id != null)
    .filter((id) => !succeeded.includes(id) && !stillUnextracted.includes(id));

  if (stillUnextracted.length > 0 || interrupted.length > 0) {
    const lines = [
      `Extraction recovery sweep found emails it could not recover.`,
      ``,
      `Retried and STILL unextracted (${stillUnextracted.length}):`,
      ...(stillUnextracted.length ? stillUnextracted.map((id) => `  ${id}`) : ["  (none)"]),
      ``,
      `Retry interrupted — started but never completed, will not be retried automatically (${interrupted.length}):`,
      ...(interrupted.length ? interrupted.map((id) => `  ${id}`) : ["  (none)"]),
      ``,
      `Candidates found this run: ${candidates.length}. Attempted: ${attempted}. Skipped for time budget: ${skippedForBudget}.`,
      `These need a manual Re-extract. Nothing was sent to any user.`,
    ];
    await notifyAdmin(
      `Extraction sweep: ${stillUnextracted.length + interrupted.length} email(s) need attention`,
      lines.join("\n"),
      "extraction_retry_failed",
    );
  }

  return {
    candidatesFound: candidates.length,
    attempted,
    succeeded,
    stillUnextracted,
    interrupted,
    skippedForBudget,
  };
}
